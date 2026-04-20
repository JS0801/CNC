/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope Public
 */
define(['N/https', 'N/file', 'N/runtime', 'N/log'], function (https, file, runtime, log) {

    var CONFIG = {
        ACCOUNT_ID: '5387755_sb2',
        LIB_FILE_ID: 42872499
    };

    var PARAMS = {
        PRIVATE_KEY: 'custscript_certificate_id',
        CERT_ID: 'custscript_kid',
        CLIENT_ID: 'custscript_client_id',
        SCOPE: 'custscript_m2m_scope'
    };

    function getTokenUrl() {
        return 'https://' + CONFIG.ACCOUNT_ID + '.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token';
    }

    function getParam(paramId, required) {
        var value = runtime.getCurrentScript().getParameter({ name: paramId });

        if (value === null || value === undefined) {
            value = '';
        }

        value = String(value);

        if (required && !value.trim()) {
            throw new Error('Missing required script parameter: ' + paramId);
        }

        return value;
    }

    function normalizePrivateKey(privateKey) {
        if (!privateKey) {
            return '';
        }

        privateKey = String(privateKey);

        // remove wrapping quotes if the whole key was pasted as a quoted string
        if (
            (privateKey.charAt(0) === '"' && privateKey.charAt(privateKey.length - 1) === '"') ||
            (privateKey.charAt(0) === "'" && privateKey.charAt(privateKey.length - 1) === "'")
        ) {
            privateKey = privateKey.substring(1, privateKey.length - 1);
        }

        // normalize escaped new lines
        privateKey = privateKey.replace(/\\r\\n/g, '\n');
        privateKey = privateKey.replace(/\\n/g, '\n');
        privateKey = privateKey.replace(/\\r/g, '\n');

        // normalize actual CRLF/CR
        privateKey = privateKey.replace(/\r\n/g, '\n');
        privateKey = privateKey.replace(/\r/g, '\n');

        // trim each line but keep line structure
        var lines = privateKey.split('\n');
        var cleaned = [];
        for (var i = 0; i < lines.length; i++) {
            if (lines[i] !== null && lines[i] !== undefined) {
                cleaned.push(String(lines[i]).trim());
            }
        }
        privateKey = cleaned.join('\n').trim();

        return privateKey;
    }

    function writeJson(response, payload) {
        response.setHeader({
            name: 'Content-Type',
            value: 'application/json'
        });
        response.write(JSON.stringify(payload));
    }

    function safeParseJson(text) {
        try {
            return JSON.parse(text);
        } catch (e) {
            return { raw: text };
        }
    }

    function loadJsrsasign(fileId) {
        var libFile = file.load({ id: fileId });
        var libCode = libFile.getContents();

        if (!libCode || libCode.length < 1000) {
            throw new Error('jsrsasign file is empty or invalid. File ID: ' + fileId);
        }

        var factory = new Function(
            'navigator',
            'window',
            libCode +
            '\n;return {' +
            'KJUR:(typeof KJUR!=="undefined")?KJUR:null,' +
            'KEYUTIL:(typeof KEYUTIL!=="undefined")?KEYUTIL:null' +
            '};'
        );

        var lib = factory({}, {});

        if (!lib || !lib.KJUR || !lib.KJUR.jws || !lib.KJUR.jws.JWS) {
            throw new Error('Loaded jsrsasign file is missing KJUR.jws.JWS');
        }

        return lib;
    }

    function buildJwtHeader(certId) {
        return {
            alg: 'PS256',
            typ: 'JWT',
            kid: certId
        };
    }

    function buildJwtPayload(clientId, scopeArray, tokenUrl) {
        var nowSec = Math.floor(new Date().getTime() / 1000);

        return {
            iss: clientId,
            scope: scopeArray,
            iat: nowSec,
            exp: nowSec + 3600,
            aud: tokenUrl
        };
    }

    function signJwt(jsrsasignLib, header, payload, privateKey) {
        try {
            return jsrsasignLib.KJUR.jws.JWS.sign(
                'PS256',
                JSON.stringify(header),
                JSON.stringify(payload),
                privateKey
            );
        } catch (e1) {
            try {
                var keyObj = jsrsasignLib.KEYUTIL.getKey(privateKey);
                return jsrsasignLib.KJUR.jws.JWS.sign(
                    'PS256',
                    JSON.stringify(header),
                    JSON.stringify(payload),
                    keyObj
                );
            } catch (e2) {
                throw new Error(
                    'Direct sign failed: ' + (e1.message || e1) +
                    ' | KEYUTIL fallback failed: ' + (e2.message || e2)
                );
            }
        }
    }

    function requestToken(tokenUrl, signedJwt) {
        var body =
            'grant_type=client_credentials' +
            '&client_assertion_type=' + encodeURIComponent('urn:ietf:params:oauth:client-assertion-type:jwt-bearer') +
            '&client_assertion=' + encodeURIComponent(signedJwt);

        return https.post({
            url: tokenUrl,
            body: body,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            }
        });
    }

    function onRequest(context) {
        var response = context.response;


      var token = `-----BEGIN PRIVATE KEY-----
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
VVwQYittEqtFlfL3ya+WZX1LURKDWg==
-----END PRIVATE KEY-----`;

        try {
            var privateKey = normalizePrivateKey(token);
            var certId = getParam(PARAMS.CERT_ID, true).trim();
            var clientId = getParam(PARAMS.CLIENT_ID, true).trim();
            var rawScope = getParam(PARAMS.SCOPE, false).trim() || 'restlets rest_webservices';

            var scopeArray = rawScope.split(/[\s,]+/).filter(function (v) {
                return !!v;
            });

            log.debug({
                title: 'Private Key Raw Check',
                details: JSON.stringify({
                    length: privateKey.length,
                    first80: privateKey.substring(0, 80),
                    last80: privateKey.substring(privateKey.length - 80),
                    hasBeginPrivateKey: privateKey.indexOf('-----BEGIN PRIVATE KEY-----') !== -1,
                    hasBeginRsaPrivateKey: privateKey.indexOf('-----BEGIN RSA PRIVATE KEY-----') !== -1,
                    hasBeginCertificate: privateKey.indexOf('-----BEGIN CERTIFICATE-----') !== -1,
                    hasEscapedNewlines: privateKey.indexOf('\\n') !== -1,
                    hasRealNewlines: privateKey.indexOf('\n') !== -1,
                    startsWithQuote: privateKey.charAt(0) === '"' || privateKey.charAt(0) === "'",
                    endsWithQuote: privateKey.charAt(privateKey.length - 1) === '"' || privateKey.charAt(privateKey.length - 1) === "'"
                })
            });

            var tokenUrl = getTokenUrl();
            var jsrsasignLib = loadJsrsasign(CONFIG.LIB_FILE_ID);
            var jwtHeader = buildJwtHeader(certId);
            var jwtPayload = buildJwtPayload(clientId, scopeArray, tokenUrl);
            var signedJwt = signJwt(jsrsasignLib, jwtHeader, jwtPayload, privateKey);

            var tokenResp = requestToken(tokenUrl, signedJwt);
            var parsedBody = safeParseJson(tokenResp.body);

            if (tokenResp.code >= 200 && tokenResp.code < 300) {
                writeJson(response, {
                    success: true,
                    data: parsedBody
                });
            } else {
                writeJson(response, {
                    success: false,
                    error: 'token_request_failed',
                    httpStatus: tokenResp.code,
                    response: parsedBody
                });
            }

        } catch (e) {
            log.error({
                title: 'Suitelet Error',
                details: e
            });

            writeJson(response, {
                success: false,
                error: 'suitelet_exception',
                message: e.message || String(e),
                name: e.name || ''
            });
        }
    }

    return {
        onRequest: onRequest
    };
});
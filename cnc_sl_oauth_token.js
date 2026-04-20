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

        try {
            var privateKey = normalizePrivateKey(getParam(PARAMS.PRIVATE_KEY, true));
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
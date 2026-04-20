/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope Public
 *
 * OAuth 2.0 M2M token generator for NetSuite using JWT Bearer assertion (PS256)
 */

define(['N/https', 'N/file', 'N/runtime', 'N/log'], function (https, file, runtime, log) {

    var CONFIG = {
        ACCOUNT_ID: '5387755_sb2',
        LIB_FILE_ID: 42872499,
        TOKEN_URL: 'https://5387755_sb2.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token'
    };

    var PARAMS = {
        PRIVATE_KEY: 'custscript_certificate_id',
        CERT_ID: 'custscript_kid',
        CLIENT_ID: 'custscript_client_id',
        SCOPE: 'custscript_m2m_scope'
    };

    function getParam(paramId, required) {
        var value = runtime.getCurrentScript().getParameter({ name: paramId });

        if (value === null || value === undefined) {
            value = '';
        }

        value = String(value).trim();

        if (required && !value) {
            throw new Error('Missing required script parameter: ' + paramId);
        }

        return value;
    }

    function normalizePrivateKey(privateKey) {
        if (!privateKey) {
            return '';
        }

        privateKey = String(privateKey).trim();

        // convert literal \n into actual line breaks
        privateKey = privateKey.replace(/\\n/g, '\n');

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
            return {
                raw: text
            };
        }
    }

    function loadJsrsasign(fileId) {
        var libFile;
        var libCode;
        var factory;
        var lib;

        try {
            libFile = file.load({ id: fileId });
        } catch (e) {
            throw new Error('Unable to load jsrsasign file. File ID: ' + fileId + '. Error: ' + (e.message || e));
        }

        libCode = libFile.getContents();

        if (!libCode || libCode.length < 1000) {
            throw new Error('jsrsasign file is empty or invalid. File ID: ' + fileId);
        }

        try {
            factory = new Function(
                'navigator',
                'window',
                libCode +
                '\n;return {' +
                'KJUR:(typeof KJUR!=="undefined")?KJUR:null,' +
                'KEYUTIL:(typeof KEYUTIL!=="undefined")?KEYUTIL:null,' +
                'RSAKey:(typeof RSAKey!=="undefined")?RSAKey:null' +
                '};'
            );
        } catch (e) {
            throw new Error('Unable to parse jsrsasign file. Error: ' + (e.message || e));
        }

        try {
            lib = factory({}, {});
        } catch (e) {
            throw new Error('Unable to execute jsrsasign file. Error: ' + (e.message || e));
        }

        if (!lib || !lib.KJUR || !lib.KJUR.jws || !lib.KJUR.jws.JWS || !lib.KEYUTIL) {
            throw new Error('Loaded jsrsasign file is missing required objects.');
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

    function buildJwtPayload(clientId, scope, tokenUrl) {
        var nowSec = Math.floor(new Date().getTime() / 1000);

        return {
            iss: clientId,
            scope: scope,
            iat: nowSec,
            exp: nowSec + 300,
            aud: tokenUrl
        };
    }

    function signJwt(jsrsasignLib, header, payload, privateKey) {
        try {
            var normalizedKey = normalizePrivateKey(privateKey);
            var keyObj = jsrsasignLib.KEYUTIL.getKey(normalizedKey);

            return jsrsasignLib.KJUR.jws.JWS.sign(
                'PS256',
                JSON.stringify(header),
                JSON.stringify(payload),
                keyObj
            );
        } catch (e) {
            throw new Error('JWT signing failed. Error: ' + (e.message || e));
        }
    }

    function requestToken(tokenUrl, signedJwt) {
        var requestBody =
            'grant_type=client_credentials' +
            '&client_assertion_type=' + encodeURIComponent('urn:ietf:params:oauth:client-assertion-type:jwt-bearer') +
            '&client_assertion=' + encodeURIComponent(signedJwt);

        return https.post({
            url: tokenUrl,
            body: requestBody,
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
            var certId = getParam(PARAMS.CERT_ID, true);
            var clientId = getParam(PARAMS.CLIENT_ID, true);
            var scope = getParam(PARAMS.SCOPE, false) || 'restlets rest_webservices';

            log.debug({
                title: 'Script Config',
                details: {
                    accountId: CONFIG.ACCOUNT_ID,
                    tokenUrl: CONFIG.TOKEN_URL,
                    libFileId: CONFIG.LIB_FILE_ID,
                    certId: certId,
                    clientId: clientId,
                    scope: scope,
                    privateKeyLength: privateKey.length,
                    keyStartsWith: privateKey.substring(0, 35),
                    hasBegin: privateKey.indexOf('-----BEGIN') !== -1,
                    hasEnd: privateKey.indexOf('-----END') !== -1,
                    hasNewLine: privateKey.indexOf('\n') !== -1
                }
            });

            var jsrsasignLib = loadJsrsasign(CONFIG.LIB_FILE_ID);

            var jwtHeader = buildJwtHeader(certId);
            var jwtPayload = buildJwtPayload(clientId, scope, CONFIG.TOKEN_URL);
            var signedJwt = signJwt(jsrsasignLib, jwtHeader, jwtPayload, privateKey);

            log.debug({
                title: 'JWT Created',
                details: {
                    header: jwtHeader,
                    payload: jwtPayload
                }
            });

            var tokenResp = requestToken(CONFIG.TOKEN_URL, signedJwt);
            var parsedBody = safeParseJson(tokenResp.body);

            log.audit({
                title: 'Token Endpoint Response',
                details: {
                    httpCode: tokenResp.code,
                    body: parsedBody
                }
            });

            if (tokenResp.code >= 200 && tokenResp.code < 300) {
                writeJson(response, {
                    success: true,
                    data: parsedBody
                });
                return;
            }

            writeJson(response, {
                success: false,
                error: 'token_request_failed',
                httpStatus: tokenResp.code,
                response: parsedBody
            });

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
/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope Public
 *
 * NetSuite OAuth 2.0 M2M token generator using JWT Bearer assertion (PS256)
 * Matching working Postman setup as closely as possible.
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

        // handle literal \n stored in parameter
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
                'RSAKey:(typeof RSAKey!=="undefined")?RSAKey:null,' +
                'KEYUTIL:(typeof KEYUTIL!=="undefined")?KEYUTIL:null' +
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
            var rawScope = getParam(PARAMS.SCOPE, false) || 'restlets rest_webservices';
            var scopeArray = rawScope.split(/[\s,]+/).filter(function (value) {
                return !!value;
            });

            var tokenUrl = getTokenUrl();

            log.debug({
                title: 'Config',
                details: {
                    accountId: CONFIG.ACCOUNT_ID,
                    tokenUrl: tokenUrl,
                    libFileId: CONFIG.LIB_FILE_ID,
                    certId: certId,
                    clientId: clientId,
                    rawScope: rawScope,
                    scopeArray: scopeArray,
                    privateKeyLength: privateKey.length,
                    keyStart: privateKey.substring(0, 40),
                    hasBegin: privateKey.indexOf('-----BEGIN') !== -1,
                    hasEnd: privateKey.indexOf('-----END') !== -1,
                    hasNewLine: privateKey.indexOf('\n') !== -1
                }
            });

            var jsrsasignLib = loadJsrsasign(CONFIG.LIB_FILE_ID);

            var jwtHeader = buildJwtHeader(certId);
            var jwtPayload = buildJwtPayload(clientId, scopeArray, tokenUrl);

            log.debug({
                title: 'JWT Header/Payload',
                details: {
                    header: jwtHeader,
                    payload: jwtPayload
                }
            });

            var signedJwt = signJwt(jsrsasignLib, jwtHeader, jwtPayload, privateKey);

            log.debug({
                title: 'JWT Signed',
                details: {
                    jwtLength: signedJwt ? signedJwt.length : 0
                }
            });

            var tokenResp = requestToken(tokenUrl, signedJwt);
            var parsedBody = safeParseJson(tokenResp.body);

            log.audit({
                title: 'Token Response',
                details: {
                    code: tokenResp.code,
                    body: parsedBody
                }
            });

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
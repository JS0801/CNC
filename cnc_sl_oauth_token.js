/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope Public
 *
 * OAuth 2.0 M2M token generator for NetSuite using JWT Bearer assertion (PS256).
 * The private key is read from a script parameter and the jsrsasign library is
 * loaded from the File Cabinet.
 */

define(['N/https', 'N/file', 'N/runtime', 'N/log'], function (https, file, runtime, log) {

    // -------------------------------------------------------------------------
    // CONFIG
    // -------------------------------------------------------------------------

    var CONFIG = {
        ACCOUNT_ID: '5387755_sb2',
        LIB_FILE_ID: 42872499,
        TOKEN_PATH: '/services/rest/auth/oauth2/v1/token'
    };

    var PARAMS = {
        PRIVATE_KEY: 'custscript_certificate_id',
        CERT_ID: 'custscript_kid',
        CLIENT_ID: 'custscript_client_id',
        SCOPE: 'custscript_m2m_scope'
    };

    // -------------------------------------------------------------------------
    // HELPERS
    // -------------------------------------------------------------------------

    function getTokenUrl() {
        return 'https://' + CONFIG.ACCOUNT_ID + '.suitetalk.api.netsuite.com' + CONFIG.TOKEN_PATH;
    }

    function getScriptParameter(paramId, isRequired) {
        var value = runtime.getCurrentScript().getParameter({ name: paramId });

        if (value === null || value === undefined) {
            value = '';
        }

        value = String(value).trim();

        if (isRequired && !value) {
            throw new Error(
                'Missing required script parameter: ' + paramId +
                '. Please set a value on the script deployment.'
            );
        }

        return value;
    }

    function writeJsonResponse(response, payload) {
        response.setHeader({
            name: 'Content-Type',
            value: 'application/json'
        });
        response.write(JSON.stringify(payload));
    }

    function loadJsrsasignLibrary(fileId) {
        var libFile;
        var libCode;
        var factory;
        var lib;

        try {
            libFile = file.load({ id: fileId });
        } catch (e) {
            throw new Error(
                'Unable to load jsrsasign library file. File ID: ' + fileId +
                '. Error: ' + (e.message || e)
            );
        }

        libCode = libFile.getContents();

        if (!libCode || libCode.length < 1000) {
            throw new Error(
                'jsrsasign library file is empty, invalid, or truncated. File ID: ' + fileId
            );
        }

        try {
            factory = new Function(
                'navigator',
                'window',
                libCode +
                '\n;return {' +
                'KJUR: (typeof KJUR !== "undefined") ? KJUR : null,' +
                'KEYUTIL: (typeof KEYUTIL !== "undefined") ? KEYUTIL : null,' +
                'RSAKey: (typeof RSAKey !== "undefined") ? RSAKey : null' +
                '};'
            );
        } catch (e) {
            throw new Error(
                'Failed to parse jsrsasign library. Error: ' + (e.message || e)
            );
        }

        try {
            lib = factory({}, {});
        } catch (e) {
            throw new Error(
                'Failed to execute jsrsasign library. Error: ' + (e.message || e)
            );
        }

        if (!lib || !lib.KJUR || !lib.KJUR.jws || !lib.KJUR.jws.JWS) {
            throw new Error(
                'jsrsasign library loaded, but KJUR.jws.JWS is not available.'
            );
        }

        return lib;
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

    function buildJwtHeader(certId) {
        return {
            alg: 'PS256',
            typ: 'JWT',
            kid: certId
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

    function requestAccessToken(tokenUrl, signedJwt) {
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

    function safeJsonParse(text) {
        try {
            return JSON.parse(text);
        } catch (e) {
            return {
                raw: text
            };
        }
    }

    // -------------------------------------------------------------------------
    // MAIN
    // -------------------------------------------------------------------------

    function onRequest(context) {
        var response = context.response;

        try {
            var privateKey = getScriptParameter(PARAMS.PRIVATE_KEY, true);
            var certId = getScriptParameter(PARAMS.CERT_ID, true);
            var clientId = getScriptParameter(PARAMS.CLIENT_ID, true);
            var scope = getScriptParameter(PARAMS.SCOPE, false) || 'restlets rest_webservices';

            var tokenUrl = getTokenUrl();

            log.debug({
                title: 'OAuth Config',
                details: {
                    accountId: CONFIG.ACCOUNT_ID,
                    tokenUrl: tokenUrl,
                    libFileId: CONFIG.LIB_FILE_ID,
                    clientId: clientId,
                    certId: certId,
                    scope: scope,
                    privateKeyLength: privateKey.length
                }
            });

            var jsrsasignLib = loadJsrsasignLibrary(CONFIG.LIB_FILE_ID);

            var jwtHeader = buildJwtHeader(certId);
            var jwtPayload = buildJwtPayload(clientId, scope, tokenUrl);
            var signedJwt = signJwt(jsrsasignLib, jwtHeader, jwtPayload, privateKey);

            log.debug({
                title: 'JWT Created',
                details: {
                    header: jwtHeader,
                    payload: jwtPayload
                }
            });

            var tokenResponse = requestAccessToken(tokenUrl, signedJwt);
            var parsedBody = safeJsonParse(tokenResponse.body);

            log.audit({
                title: 'Token Response',
                details: {
                    httpCode: tokenResponse.code,
                    body: parsedBody
                }
            });

            if (tokenResponse.code >= 200 && tokenResponse.code < 300) {
                writeJsonResponse(response, parsedBody);
                return;
            }

            writeJsonResponse(response, {
                success: false,
                error: 'token_request_failed',
                httpStatus: tokenResponse.code,
                response: parsedBody
            });

        } catch (e) {
            log.error({
                title: 'Suitelet Error',
                details: e
            });

            writeJsonResponse(response, {
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
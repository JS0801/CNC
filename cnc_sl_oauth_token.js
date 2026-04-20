/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope Public
 *
 * Returns a NetSuite OAuth 2.0 bearer token (M2M / JWT Bearer assertion, PS256),
 * signed with a PEM private key using the jsrsasign library loaded from the
 * File Cabinet.
 *
 * SCRIPT PARAMETERS (Script record → Parameters tab)
 *   ID                        TYPE             LABEL
 *   custscript_secret_id      Long Text        Private Key (PEM, full text with header/footer)
 *   custscript_kid            Free-Form Text   Certificate ID (kid)
 *   custscript_client_id      Free-Form Text   Client ID (Consumer Key)
 *   custscript_m2m_scope      Free-Form Text   (optional) default "restlets rest_webservices"
 *
 * Account ID and jsrsasign file ID are hardcoded below — edit the two constants
 * at the top of the module if you deploy this elsewhere.
 */
define(['N/https', 'N/file', 'N/runtime', 'N/log'],
function (https, file, runtime, log) {

    // ---------- hardcoded for this deployment ----------

    var ACCOUNT_ID  = '5387755_sb2';   // NetSuite account ID (lowercase, underscore)
    var LIB_FILE_ID = 42872499;        // File Cabinet internal ID of jsrsasign-all-min.js

    // ---------- script-parameter IDs ----------

    var PARAM = {
        PRIVATE_KEY: 'custscript_certificate_id',   // PEM private key
        CERT_ID:     'custscript_kid',          // used as JWT header "kid"
        CLIENT_ID:   'custscript_client_id',    // integration's Consumer Key
        SCOPE:       'custscript_m2m_scope'     // optional
    };

    // ---------- helpers ----------

    function readParam(name, required) {
        var v = runtime.getCurrentScript().getParameter({ name: name });
        if (v === null || v === undefined) v = '';
        v = String(v).trim();
        if (required && v === '') {
            throw new Error(
                'Script parameter "' + name + '" has no value. ' +
                'Confirm it exists on the Script record AND that this Deployment ' +
                'has a value set under Parameters.'
            );
        }
        return v;
    }

    function writeJson(response, payload) {
        response.setHeader({ name: 'Content-Type', value: 'application/json' });
        response.write(JSON.stringify(payload));
    }

    /**
     * Loads jsrsasign by inlining its source code as the body of a Function
     * constructor. KJUR / RSAKey / KEYUTIL become local vars of that function,
     * and we return them explicitly. No eval() involved.
     */
    function loadJsrsasign(fileId) {
        var libFile;
        try {
            libFile = file.load({ id: fileId });
        } catch (e) {
            throw new Error(
                'Could not load jsrsasign file (id=' + fileId + '). ' +
                'Underlying error: ' + (e.message || e)
            );
        }

        var libCode = libFile.getContents();
        if (!libCode || libCode.length < 1000) {
            throw new Error(
                'jsrsasign file (id=' + fileId + ') looks empty or truncated ' +
                '(size=' + (libCode ? libCode.length : 0) + ' bytes).'
            );
        }

        var factory;
        try {
            factory = new Function(
                'navigator', 'window',
                libCode +
                '\n;return {' +
                '  KJUR:    (typeof KJUR    !== "undefined") ? KJUR    : null,' +
                '  RSAKey:  (typeof RSAKey  !== "undefined") ? RSAKey  : null,' +
                '  KEYUTIL: (typeof KEYUTIL !== "undefined") ? KEYUTIL : null ' +
                '};'
            );
        } catch (e) {
            throw new Error(
                'Failed to parse jsrsasign source (id=' + fileId + '): ' +
                (e.message || e)
            );
        }

        var lib = factory({}, {});
        if (!lib || !lib.KJUR || !lib.KJUR.jws || !lib.KJUR.jws.JWS) {
            throw new Error(
                'Loaded jsrsasign (id=' + fileId + ') but KJUR.jws.JWS is missing. ' +
                'Is the file really jsrsasign-all-min.js?'
            );
        }
        return lib;
    }

    // ---------- main ----------

    function onRequest(context) {
        var response = context.response;

        try {
            // --- Read config ---
            var privateKey = readParam(PARAM.PRIVATE_KEY, true);
            var certKid    = readParam(PARAM.CERT_ID,     true);
            var clientId   = readParam(PARAM.CLIENT_ID,   true);
            var rawScope   = readParam(PARAM.SCOPE,       false) || 'restlets rest_webservices';
            var scopeArr   = rawScope.split(/[\s,]+/).filter(Boolean);

            var tokenUrl = 'https://' + ACCOUNT_ID +
                '.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token';

            log.debug({
                title: 'Config loaded',
                details: {
                    clientId:      clientId,
                    accountId:     ACCOUNT_ID,
                    libFileId:     LIB_FILE_ID,
                    kid:           certKid,
                    scopes:        scopeArr,
                    privateKeyLen: privateKey.length,
                    privateKeyStartsWith: privateKey.substring(0, 27)  // sanity check
                }
            });

            // --- Load jsrsasign ---
            var jsr  = loadJsrsasign(LIB_FILE_ID);
            var KJUR = jsr.KJUR;

            // --- Build JWT (same shape as Postman) ---
            var jwtHeader = {
                alg: 'PS256',
                typ: 'JWT',
                kid: certKid
            };

            var nowSec = Math.floor(Date.now() / 1000);
            var jwtPayload = {
                iss:   clientId,
                scope: scopeArr,
                iat:   nowSec,
                exp:   nowSec + 3600,  // max 1 hour per NetSuite
                aud:   tokenUrl
            };

            // --- Sign ---
            var signedJWT = KJUR.jws.JWS.sign(
                'PS256',
                JSON.stringify(jwtHeader),
                JSON.stringify(jwtPayload),
                privateKey
            );

            // --- Exchange JWT for access token ---
            var formBody =
                'grant_type=client_credentials' +
                '&client_assertion_type=' +
                    encodeURIComponent('urn:ietf:params:oauth:client-assertion-type:jwt-bearer') +
                '&client_assertion=' + encodeURIComponent(signedJWT);

            var tokenResp = https.post({
                url: tokenUrl,
                body: formBody,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept':       'application/json'
                }
            });

            log.audit({
                title:   'Token endpoint response',
                details: 'HTTP ' + tokenResp.code
            });

            var parsed;
            try { parsed = JSON.parse(tokenResp.body); }
            catch (e) { parsed = { raw: tokenResp.body }; }

            if (tokenResp.code >= 200 && tokenResp.code < 300) {
                // Success: { access_token, expires_in, token_type, scope }
                writeJson(response, parsed);
            } else {
                writeJson(response, {
                    error:       'token_request_failed',
                    http_status: tokenResp.code,
                    response:    parsed
                });
            }

        } catch (err) {
            log.error({ title: 'Bearer token Suitelet error', details: err });
            writeJson(response, {
                error:   'suitelet_exception',
                message: err.message || String(err),
                name:    err.name || null
            });
        }
    }

    return { onRequest: onRequest };
});
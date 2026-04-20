/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope Public
 *
 * Suitelet: Return a NetSuite OAuth 2.0 Bearer Token
 * -----------------------------------------------------------------------------
 * Flow: Client Credentials (M2M) with JWT Bearer Assertion, signed with PS256
 * using a raw PEM private key and the jsrsasign library — mirrors the Postman
 * collection behavior.
 *
 * ONE-TIME SETUP
 * -----------------------------------------------------------------------------
 * 1. Download jsrsasign:
 *      https://kjur.github.io/jsrsasign/jsrsasign-latest-all-min.js
 * 2. Upload to File Cabinet, e.g.:
 *      /SuiteScripts/lib/jsrsasign-all-min.js
 * 3. Copy the file's path OR internal ID — you'll put it in the LIB_PATH param.
 *
 * SCRIPT PARAMETERS (on the Script record, "Parameters" tab)
 * -----------------------------------------------------------------------------
 *   ID                             TYPE             LABEL
 *   custscript_m2m_private_key     Long Text        Private Key (PEM)
 *   custscript_m2m_cert_id         Free-Form Text   Certificate ID (kid)
 *   custscript_m2m_client_id       Free-Form Text   Client ID (Consumer Key)
 *   custscript_m2m_client_secret   Password         Client Secret (stored, not sent)
 *   custscript_m2m_account_id      Free-Form Text   Account ID (e.g. 1234567_sb1)
 *   custscript_m2m_lib_path        Free-Form Text   Path or ID of jsrsasign-all-min.js
 *   custscript_m2m_scope           Free-Form Text   (optional) default
 *                                                   "restlets rest_webservices"
 *
 * Paste the PEM private key INCLUDING the header/footer lines, e.g.:
 *   -----BEGIN PRIVATE KEY-----
 *   MIIEvQIBADANBgkqhkiG9w0BAQEF...
 *   -----END PRIVATE KEY-----
 *
 * SECURITY NOTE
 * -----------------------------------------------------------------------------
 * Putting a raw PEM into a script parameter means any admin with script access
 * can read it. The "Password" field type encrypts Client Secret but does not
 * apply to Long Text. If that's a concern, switch to the N/crypto/certificate
 * approach (upload the cert to NetSuite and reference it by certId instead).
 */
define(['N/https', 'N/file', 'N/runtime', 'N/log'],
function (https, file, runtime, log) {

    // ---------- parameter IDs ----------

    var PARAM = {
        PRIVATE_KEY:   'custscript_secret_id',
        CERT_ID:       'custscript_kid',        // kid
        CLIENT_ID:     'custscript_client_id',
        CLIENT_SECRET: 'custscript_secret_id',  // stored, not sent
        SCOPE:         'custscript_m2m_scope'
    };

    // ---------- helpers ----------

    function readParam(name, required) {
        var v = runtime.getCurrentScript().getParameter({ name: name });
        v = (v == null) ? '' : String(v).trim();
        if (required && !v) {
            throw new Error('Script parameter "' + name + '" is not set on this deployment.');
        }
        return v;
    }

    function writeJson(response, payload) {
        response.setHeader({ name: 'Content-Type', value: 'application/json' });
        response.write(JSON.stringify(payload));
    }

    /**
     * Loads jsrsasign from the File Cabinet and returns { KJUR, RSAKey, KEYUTIL }.
     *
     * jsrsasign declares KJUR/RSAKey/KEYUTIL as top-level vars and probes
     * `window`/`navigator`. We eval the code inside a Function (non-strict), shim
     * the globals it looks for, and return the identifiers we need.
     */
    function loadJsrsasign(p) {
        var libFile = file.load({ id: 42872499 });
        var libCode = libFile.getContents();

        var factory = new Function(
            'libCode',
            'var window = {}; var navigator = {}; ' +
            'eval(libCode); ' +
            'return { ' +
            '  KJUR:    typeof KJUR    !== "undefined" ? KJUR    : (window.KJUR    || null), ' +
            '  RSAKey:  typeof RSAKey  !== "undefined" ? RSAKey  : (window.RSAKey  || null), ' +
            '  KEYUTIL: typeof KEYUTIL !== "undefined" ? KEYUTIL : (window.KEYUTIL || null)  ' +
            '};'
        );

        var lib = factory(libCode);
        if (!lib || !lib.KJUR || !lib.KJUR.jws || !lib.KJUR.jws.JWS) {
            throw new Error('Failed to load jsrsasign from "' + pathOrId +
                            '" — KJUR.jws.JWS not found.');
        }
        return lib;
    }

    // ---------- main ----------

    function onRequest(context) {
        var response = context.response;

        try {
            // --- Read config ---
            var privateKey   = readParam(PARAM.PRIVATE_KEY,   true);
            var certKid      = readParam(PARAM.CERT_ID,       true);
            var clientId     = readParam(PARAM.CLIENT_ID,     true);
            var clientSecret = readParam(PARAM.CLIENT_SECRET, false);
            var accountId    = '5387755_sb2';
            var libPath      = null;
            var rawScope     = readParam(PARAM.SCOPE,         false) || 'restlets rest_webservices';
            var scopeArr     = rawScope.split(/[\s,]+/).filter(Boolean);
            void clientSecret; // silencing unused-var; kept as param for config completeness

            var tokenUrl = 'https://' + accountId +
                '.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token';

            // --- Load jsrsasign ---
            var jsr  = loadJsrsasign(libPath);
            var KJUR = jsr.KJUR;

            // --- Build JWT (same shape as the Postman pre-request script) ---
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
                exp:   nowSec + 3600,   // max 1 hour per NetSuite
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
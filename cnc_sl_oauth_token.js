/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * 
 * Generates an OAuth 2.0 Bearer Token from NetSuite using the 
 * JWT Client Credentials (M2M) flow.
 * 
 * Required Script Parameters:
 *   - custscript_client_id       : OAuth 2.0 Client ID (Consumer Key / Integration)
 *   - custscript_certificate_id  : Internal ID of the Certificate record in NetSuite
 *   - custscript_kid             : Certificate ID (kid) shown on the Integration record
 * 
 * Optional:
 *   - custscript_scope           : Space-separated scopes (default: "restlets rest_webservices")
 */
define(['N/https', 'N/encode', 'N/crypto/certificate', 'N/runtime', 'N/log', 'N/error'],
(https, encode, certificate, runtime, log, error) => {

    // ---------- CONFIG ----------
    // Set this to match how your certificate was uploaded in NetSuite:
    //   'ES256' -> EC certificate (recommended)
    //   'RS256' -> RSA certificate
    const SIGNING_ALG = 'ES256';
    // ----------------------------

    const onRequest = (scriptContext) => {
        try {
            if (scriptContext.request.method !== 'GET' &&
                scriptContext.request.method !== 'POST') {
                throw error.create({
                    name: 'INVALID_METHOD',
                    message: 'Only GET and POST are supported.'
                });
            }

            const config = loadConfig();
            const jwt = buildJwtAssertion(config);
            const tokenResponse = requestAccessToken(config.tokenEndpoint, jwt);

            scriptContext.response.setHeader({
                name: 'Content-Type',
                value: 'application/json'
            });
            scriptContext.response.write(tokenResponse);

        } catch (e) {
            log.error({ title: 'OAuth Token Generation Failed', details: e });
            scriptContext.response.setHeader({
                name: 'Content-Type',
                value: 'application/json'
            });
            scriptContext.response.write(JSON.stringify({
                error: 'token_generation_failed',
                message: e.message || String(e)
            }));
        }
    };

    // ---------------- Helpers ----------------

    /**
     * Loads and validates script parameters.
     */
    const loadConfig = () => {
        const script = runtime.getCurrentScript();

        const clientId      = script.getParameter({ name: 'custscript_client_id' });
        const certRecordId  = script.getParameter({ name: 'custscript_certificate_id' });
        const kid           = script.getParameter({ name: 'custscript_kid' });
        const scopeParam    = script.getParameter({ name: 'custscript_scope' });

        if (!clientId)     throw new Error('Missing parameter: custscript_client_id');
        if (!certRecordId) throw new Error('Missing parameter: custscript_certificate_id');
        if (!kid)          throw new Error('Missing parameter: custscript_kid');

        // Build account-specific token endpoint.
        // Account IDs with underscores (e.g. sandbox: TSTDRV_SB1) must be dashed & lowercased.
        const accountId = runtime.accountId.replace(/_/g, '-').toLowerCase();
        const tokenEndpoint =
            `https://${accountId}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;

        const scope = (scopeParam && String(scopeParam).trim())
            ? String(scopeParam).trim()
            : 'restlets rest_webservices';

        log.debug({
            title: 'Config loaded',
            details: { accountId, tokenEndpoint, clientId, kid, scope }
        });

        return { clientId, certRecordId, kid, scope, tokenEndpoint };
    };

    /**
     * Builds and signs the JWT client assertion.
     */
    const buildJwtAssertion = (config) => {
        const header = {
            alg: SIGNING_ALG,
            typ: 'JWT',
            kid: config.kid
        };

        const now = Math.floor(Date.now() / 1000);
        const payload = {
            iss:   config.clientId,
            sub:   config.clientId,
            aud:   config.tokenEndpoint,
            iat:   now - 30,         // small backdate for clock skew
            exp:   now + 300,        // 5 minutes
            scope: config.scope.split(/\s+/)  // NetSuite accepts a string array
        };

        const encodedHeader  = base64UrlEncode(JSON.stringify(header));
        const encodedPayload = base64UrlEncode(JSON.stringify(payload));
        const dataToSign     = `${encodedHeader}.${encodedPayload}`;

        const signer = certificate.createSigner({
            certId:    config.certRecordId,
            algorithm: certificate.HashAlg.SHA256
        });
        signer.update({ input: dataToSign });

        // useRawFormatForECDSA is required for ES256/ES512 JWTs (R||S format).
        // It's ignored for RSA, so it's safe to always pass for ECDSA flows.
        const signOptions = {
            outputEncoding: encode.Encoding.BASE_64_URL_SAFE
        };
        if (SIGNING_ALG.startsWith('ES')) {
            signOptions.useRawFormatForECDSA = true;
        }

        const signature = signer.sign(signOptions).replace(/=+$/g, '');
        const jwt = `${dataToSign}.${signature}`;

        log.debug({ title: 'JWT Assertion built', details: { header, payload } });
        return jwt;
    };

    /**
     * Exchanges the JWT assertion for an access token.
     */
    const requestAccessToken = (tokenEndpoint, jwtAssertion) => {
        const response = https.post({
            url: tokenEndpoint,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept':       'application/json'
            },
            body: {
                grant_type:            'client_credentials',
                client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
                client_assertion:      jwtAssertion
            }
        });

        log.debug({
            title: 'Token endpoint response',
            details: { code: response.code, body: response.body }
        });

        if (response.code !== 200) {
            throw new Error(
                `Token endpoint returned HTTP ${response.code}: ${response.body}`
            );
        }

        return response.body;
    };

    /**
     * Base64URL-encodes a UTF-8 string (no padding).
     */
    const base64UrlEncode = (str) => {
        return encode.convert({
            string:         str,
            inputEncoding:  encode.Encoding.UTF_8,
            outputEncoding: encode.Encoding.BASE_64_URL_SAFE
        }).replace(/=+$/g, '');
    };

    return { onRequest };
});
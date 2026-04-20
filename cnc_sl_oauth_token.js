/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * Generates an OAuth 2.0 Bearer Token from NetSuite using the
 * JWT Client Credentials (M2M) flow with an RSA-PSS certificate.
 *
 * Script Parameters:
 *   custscript_client_id       - Consumer Key / Client ID from the Integration record
 *   custscript_certificate_id  - Script ID of the Certificate record in NetSuite
 *                                (the "ID" field on Setup > Company > Preferences > Certificates)
 *   custscript_kid             - Certificate ID from the OAuth 2.0 Client Credentials
 *                                (M2M) Setup mapping row
 *   custscript_scope           - Optional. Space-separated. Default: "rest_webservices"
 */
define(['N/https', 'N/encode', 'N/crypto/certificate', 'N/runtime', 'N/log'],
(https, encode, certificate, runtime, log) => {

    const onRequest = (scriptContext) => {
        try {
            const cfg = loadConfig();
            const jwt = buildJwtAssertion(cfg);
            const tokenBody = requestAccessToken(cfg.tokenEndpoint, jwt);

            scriptContext.response.setHeader({ name: 'Content-Type', value: 'application/json' });
            scriptContext.response.write(tokenBody);
        } catch (e) {
            log.error({ title: 'Token generation failed', details: e });
            scriptContext.response.setHeader({ name: 'Content-Type', value: 'application/json' });
            scriptContext.response.write(JSON.stringify({
                error:   'token_generation_failed',
                message: e.message || String(e)
            }));
        }
    };

    const loadConfig = () => {
        const script = runtime.getCurrentScript();

        const clientId     = script.getParameter({ name: 'custscript_client_id' });
        const certRecordId = script.getParameter({ name: 'custscript_certificate_id' });
        const kid          = script.getParameter({ name: 'custscript_kid' });
        const scopeParam   = script.getParameter({ name: 'custscript_scope' });

        if (!clientId)     throw new Error('Missing parameter: custscript_client_id');
        if (!certRecordId) throw new Error('Missing parameter: custscript_certificate_id');
        if (!kid)          throw new Error('Missing parameter: custscript_kid');

        // Sandbox/release-preview account IDs use underscores -> must become dashes, lowercased.
        const accountId = runtime.accountId.replace(/_/g, '-').toLowerCase();
        const tokenEndpoint =
            `https://${accountId}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;

        // Default to rest_webservices only. Add "restlets" if your integration allows it
        // AND you actually need to call RESTlets.
        const scopes = (scopeParam && String(scopeParam).trim()
                          ? String(scopeParam).trim()
                          : 'rest_webservices').split(/\s+/);

        log.debug({ title: 'Config', details: { accountId, tokenEndpoint, clientId, kid, scopes } });
        return { clientId, certRecordId, kid, scopes, tokenEndpoint };
    };

    const buildJwtAssertion = (cfg) => {
        // PS256 is correct when your certificate was generated with RSA-PSS padding,
        // which is the NetSuite-recommended setup for OAuth 2.0 M2M.
        const header = { alg: 'ES256', typ: 'JWT', kid: cfg.kid };

        const now = Math.floor(Date.now() / 1000);
        const payload = {
            iss:   cfg.clientId,
            aud:   cfg.tokenEndpoint,
            iat:   now,
            exp:   now + 300,       // 5 minutes
            scope: cfg.scopes       // array form: ["rest_webservices"] or ["restlets","rest_webservices"]
        };

        const encodedHeader  = base64UrlEncode(JSON.stringify(header));
        const encodedPayload = base64UrlEncode(JSON.stringify(payload));
        const dataToSign     = `${encodedHeader}.${encodedPayload}`;

        const signer = certificate.createSigner({
            certId:    cfg.certRecordId,
            algorithm: certificate.HashAlg.SHA256
        });
        signer.update({ input: dataToSign });

        const signature = signer.sign({
            outputEncoding: encode.Encoding.BASE_64_URL_SAFE
        }).replace(/=+$/g, '');

        const jwt = `${dataToSign}.${signature}`;
        log.debug({ title: 'JWT payload', details: payload });
        return jwt;
    };

    const requestAccessToken = (tokenEndpoint, jwt) => {
        const resp = https.post({
            url: tokenEndpoint,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept':       'application/json'
            },
            body: {
                grant_type:            'client_credentials',
                client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
                client_assertion:      jwt
            }
        });

        log.debug({ title: 'Token response', details: { code: resp.code, body: resp.body } });

        if (resp.code !== 200) {
            throw new Error(`Token endpoint returned HTTP ${resp.code}: ${resp.body}`);
        }
        return resp.body;
    };

    const base64UrlEncode = (str) => encode.convert({
        string:         str,
        inputEncoding:  encode.Encoding.UTF_8,
        outputEncoding: encode.Encoding.BASE_64_URL_SAFE
    }).replace(/=+$/g, '');

    return { onRequest };
});
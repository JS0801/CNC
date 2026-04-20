/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/https', 'N/encode', 'N/crypto/certificate', 'N/runtime', 'N/log'], (https, encode, certificate, runtime, log) => {

    const onRequest = (scriptContext) => {
        try {
            const scriptObj = runtime.getCurrentScript();
            const clientId = scriptObj.getParameter({ name: 'custscript_client_id' });
            const certRecordId = scriptObj.getParameter({ name: 'custscript_certificate_id' });
            const kid = scriptObj.getParameter({ name: 'custscript_kid' });

            const accountId = runtime.accountId.replace('_', '-').toLowerCase();
            const tokenEndpoint = `https://${accountId}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;

            log.debug('tokenEndpoint', {
              tokenEndpoint: tokenEndpoint,
            })
            // 1. JWT Assertion
            const header = { alg: 'PS256', typ: 'JWT', kid: kid };
            const now = Math.floor(Date.now() / 1000);
            const payload = {
                iss: clientId,
                scope: 'restlets,rest_webservices', // MUST BE STRING
                iat: now - 30, // 30 seconds slack
                exp: now + 300,
                aud: tokenEndpoint
            };

            const encodedHeader = base64UrlEncode(JSON.stringify(header));
            const encodedPayload = base64UrlEncode(JSON.stringify(payload));
            const dataToSign = `${encodedHeader}.${encodedPayload}`;

            const signer = certificate.createSigner({
                certId: certRecordId,
                algorithm: certificate.HashAlg.SHA256
            });
            signer.update({ input: dataToSign });
            const signature = signer.sign({ 
                                outputEncoding: encode.Encoding.BASE_64_URL_SAFE , 
                                useRawFormatForECDSA: true 
                              }).replace(/=/g, '');

            const jwtAssertion = `${dataToSign}.${signature}`;

            // 2. Token Request
            const resp = https.post({
                url: tokenEndpoint,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: {
                    grant_type: 'client_credentials',
                    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
                    client_assertion: jwtAssertion
                }
            });

            log.debug('Final Result', resp.body);
            scriptContext.response.setHeader({ name: 'Content-Type', value: 'application/json' });
            scriptContext.response.write(resp.body);

        } catch (e) {
            log.error('Error', e);
            scriptContext.response.write(JSON.stringify({ error: e.message }));
        }
    };

    const base64UrlEncode = (str) => {
        return encode.convert({
            string: str,
            inputEncoding: encode.Encoding.UTF_8,
            outputEncoding: encode.Encoding.BASE_64_URL_SAFE
        }).replace(/=/g, '');
    };

    return { onRequest };
});

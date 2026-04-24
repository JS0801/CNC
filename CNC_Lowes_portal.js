/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope Public
 */
define(['N/https', 'N/file', 'N/runtime', 'N/log'], function (https, file, runtime, log) {

    function onRequest(context) {
        var request = context.request;
        var response = context.response;

        log.debug('Request Received', {
            method: request.method,
            url: request.url
        });
    }

    return {
        onRequest: onRequest
    };
});

/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/search', 'N/record', 'N/log'], function (search, record, log) {

    const EDI_PRODUCT_SERVICE_ID = '1013534250';

    function afterSubmit(context) {
        if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT) return;

        try {
            var newRec = context.newRecord;
            var soId = newRec.id;
            var customerId = newRec.getValue('entity');
            const recType = context.newRecord.type;
            const orderStatus = newRec.getValue({ fieldId: 'orderstatus' });
            if (recType === record.Type.SALES_ORDER && orderStatus !== 'A') {
               log.debug('Skipping record - not Pending Approval', orderStatus);
               return;
            };

            // Step 1: Run Saved Search Logic
            var resultMap = {};

            //["status","anyof","SalesOrd:A"], 

            var results = search.create({
                type: recType,
                filters: [
                    ["type", "anyof", "SalesOrd", "Estimate"], "AND",
                    ["name", "anyof", "161136"], "AND",
                    ["mainline", "is", "F"], "AND",
                    // ["item", "anyof", "306263"], "AND", // placeholder item
                    ["internalidnumber", "equalto", soId], "AND",
                    ["status","anyof","SalesOrd:A"], "AND",
                    [
                        ["item.custitem_yy_availableso", "is", "T"], "OR",
                        ["item.type", "anyof", "Discount", "Kit", "Markup", "NonInvtPart", "OthCharge", "Subtotal"]
                    ], "AND",
                    ["item.custitem14", "doesnotcontain", "Check transactions"], "AND",
                    ["item.isinactive", "is", "F"], "AND",
                    ["item.custitem_mb_cncproductline", "noneof", "26"], "AND",
                    ["item.custitem_mb_item_group", "noneof", "7"], "AND",
                    ["item.custitem_yy_launchdate", "notafter", "today"], "AND",
                    ["item.custitem_yy_it_priceonly", "is", "F"]
                ],
                columns: [
    search.createColumn({ name: "custcol_boomi_edi_item_name" }),
                  search.createColumn({
    name: "formulatext",
    formula:
        "CASE " +
        "WHEN REGEXP_LIKE({custcol_boomi_edi_item_name}, '^CW[0-9]+[LR]$') THEN " +
        "  CASE " +
        "    WHEN {custcol_rsm_item_tag} IN ('CONCORD / ELEGANT WHITE', 'ELEGANT WHITE') THEN 'EB10-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
        "    WHEN {custcol_rsm_item_tag} = 'CONCORD / ELEGANT OCEAN' THEN 'EB27-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
        "    WHEN {custcol_rsm_item_tag} LIKE 'ELEGANT PLUS%' THEN 'EBP-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
        "    WHEN {custcol_rsm_item_tag} = 'ROYAL WHITE' THEN 'L10-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
        "    WHEN {custcol_rsm_item_tag} = 'ROYAL SMOKY GREY' THEN 'L02-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
        "    WHEN {custcol_rsm_item_tag} = 'ROYAL MISTY GREY' THEN 'L03-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
        "    WHEN {custcol_rsm_item_tag} = 'ROYAL HARVEST' THEN 'L05-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
        "    WHEN {custcol_rsm_item_tag} = 'ROYAL ESPRESSO' THEN 'L11-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
        "    WHEN {custcol_rsm_item_tag} = 'BROADWAY' THEN 'BMM650-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
        //"    WHEN {custcol_rsm_item_tag} = 'MILANO' THEN 'MPM452-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
        "    WHEN {custcol_rsm_item_tag} = 'SYDNEY PLUS BOURBON (P)' THEN 'SKP-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
        "    WHEN {custcol_rsm_item_tag} = 'NEWPORT PLUS BOURBON (D)' THEN 'NKP-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
        "    WHEN {custcol_rsm_item_tag} = 'NEWPORT PLUS SLEEK WHITE (M)' THEN 'NBP-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
        "    ELSE REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
        "  END " +
        "WHEN REGEXP_LIKE({custcol_boomi_edi_item_name}, '^[0-9]+[A-Z]$') THEN " +
        "  CASE " +
        "    WHEN {custcol_rsm_item_tag} IN ('CONCORD / ELEGANT WHITE', 'ELEGANT WHITE') THEN 'EB10-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
        "    WHEN {custcol_rsm_item_tag} = 'CONCORD / ELEGANT OCEAN' THEN 'EB27-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
        "    WHEN {custcol_rsm_item_tag} LIKE 'ELEGANT PLUS%' THEN 'EBP-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
        "    WHEN {custcol_rsm_item_tag} = 'ROYAL WHITE' THEN 'L10-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
        "    WHEN {custcol_rsm_item_tag} = 'ROYAL SMOKY GREY' THEN 'L02-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
        "    WHEN {custcol_rsm_item_tag} = 'ROYAL MISTY GREY' THEN 'L03-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
        "    WHEN {custcol_rsm_item_tag} = 'ROYAL HARVEST' THEN 'L05-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
        "    WHEN {custcol_rsm_item_tag} = 'ROYAL ESPRESSO' THEN 'L11-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
        "    WHEN {custcol_rsm_item_tag} = 'BROADWAY' THEN 'BMM650-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
        //"    WHEN {custcol_rsm_item_tag} = 'MILANO' THEN 'MPM452-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
        "    WHEN {custcol_rsm_item_tag} = 'SYDNEY PLUS BOURBON (P)' THEN 'SKP-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
        "    WHEN {custcol_rsm_item_tag} = 'NEWPORT PLUS BOURBON (D)' THEN 'NKP-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
        "    WHEN {custcol_rsm_item_tag} = 'NEWPORT PLUS SLEEK WHITE (M)' THEN 'NBP-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
        "    ELSE REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
        "  END " +
        "ELSE " +
        "  CASE " +
        "    WHEN {custcol_rsm_item_tag} IN ('CONCORD / ELEGANT WHITE', 'ELEGANT WHITE') THEN 'EB10-' || {custcol_boomi_edi_item_name} " +
        "    WHEN {custcol_rsm_item_tag} = 'CONCORD / ELEGANT OCEAN' THEN 'EB27-' || {custcol_boomi_edi_item_name} " +
        "    WHEN {custcol_rsm_item_tag} LIKE 'ELEGANT PLUS%' THEN 'EBP-' || {custcol_boomi_edi_item_name} " +
        "    WHEN {custcol_rsm_item_tag} = 'ROYAL WHITE' THEN 'L10-' || {custcol_boomi_edi_item_name} " +
        "    WHEN {custcol_rsm_item_tag} = 'ROYAL SMOKY GREY' THEN 'L02-' || {custcol_boomi_edi_item_name} " +
        "    WHEN {custcol_rsm_item_tag} = 'ROYAL MISTY GREY' THEN 'L03-' || {custcol_boomi_edi_item_name} " +
        "    WHEN {custcol_rsm_item_tag} = 'ROYAL HARVEST' THEN 'L05-' || {custcol_boomi_edi_item_name} " +
        "    WHEN {custcol_rsm_item_tag} = 'ROYAL ESPRESSO' THEN 'L11-' || {custcol_boomi_edi_item_name} " +
        "    WHEN {custcol_rsm_item_tag} = 'BROADWAY' THEN 'BMM650-' || {custcol_boomi_edi_item_name} " +
        //"    WHEN {custcol_rsm_item_tag} = 'MILANO' THEN 'MPM452-' || {custcol_boomi_edi_item_name} " +
        "    WHEN {custcol_rsm_item_tag} = 'SYDNEY PLUS BOURBON (P)' THEN 'SKP-' || {custcol_boomi_edi_item_name} " +
        "    WHEN {custcol_rsm_item_tag} = 'NEWPORT PLUS BOURBON (D)' THEN 'NKP-' || {custcol_boomi_edi_item_name} " +
        "    WHEN {custcol_rsm_item_tag} = 'NEWPORT PLUS SLEEK WHITE (M)' THEN 'NBP-' || {custcol_boomi_edi_item_name} " +
        "    ELSE {custcol_boomi_edi_item_name} " +
        "  END " +
        "END",
    label: "Transformed Name"
})
//     search.createColumn({
//     name: "formulatext",
//     formula:
//         "CASE " +
//         "WHEN REGEXP_LIKE({custcol_boomi_edi_item_name}, '^CW[0-9]+[LR]$') THEN " +
//         "  CASE " +
//         "    WHEN {custcol_rsm_item_tag} IN ('CONCORD / ELEGANT WHITE', 'ELEGANT WHITE') THEN 'EB10-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
//         "    WHEN {custcol_rsm_item_tag} = 'CONCORD / ELEGANT OCEAN' THEN 'EB27-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
//         "    WHEN {custcol_rsm_item_tag} LIKE 'ELEGANT PLUS%' THEN 'EBP-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
//         "    WHEN {custcol_rsm_item_tag} = 'ROYAL WHITE' THEN 'L10-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
//         "    WHEN {custcol_rsm_item_tag} = 'ROYAL SMOKY GREY' THEN 'L02-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
//         "    WHEN {custcol_rsm_item_tag} = 'ROYAL MISTY GREY' THEN 'L03-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
//         "    WHEN {custcol_rsm_item_tag} = 'ROYAL HARVEST' THEN 'L05-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
//         "    WHEN {custcol_rsm_item_tag} = 'ROYAL ESPRESSO' THEN 'L11-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
//         "    WHEN {custcol_rsm_item_tag} = 'BROADWAY' THEN 'BMM650-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
//         //"    WHEN {custcol_rsm_item_tag} = 'MILANO' THEN 'MPM452-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
//         "    WHEN {custcol_rsm_item_tag} = 'SYDNEY PLUS BOURBON (P)' THEN 'SKP-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
//         "    ELSE REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
//         "  END " +
//         "WHEN REGEXP_LIKE({custcol_boomi_edi_item_name}, '^[0-9]+[A-Z]$') THEN " +
//         "  CASE " +
//         "    WHEN {custcol_rsm_item_tag} IN ('CONCORD / ELEGANT WHITE', 'ELEGANT WHITE') THEN 'EB10-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
//         "    WHEN {custcol_rsm_item_tag} = 'CONCORD / ELEGANT OCEAN' THEN 'EB27-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
//         "    WHEN {custcol_rsm_item_tag} LIKE 'ELEGANT PLUS%' THEN 'EBP-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
//         "    WHEN {custcol_rsm_item_tag} = 'ROYAL WHITE' THEN 'L10-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
//         "    WHEN {custcol_rsm_item_tag} = 'ROYAL SMOKY GREY' THEN 'L02-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
//         "    WHEN {custcol_rsm_item_tag} = 'ROYAL MISTY GREY' THEN 'L03-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
//         "    WHEN {custcol_rsm_item_tag} = 'ROYAL HARVEST' THEN 'L05-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
//         "    WHEN {custcol_rsm_item_tag} = 'ROYAL ESPRESSO' THEN 'L11-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
//         "    WHEN {custcol_rsm_item_tag} = 'BROADWAY' THEN 'BMM650-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
//         //"    WHEN {custcol_rsm_item_tag} = 'MILANO' THEN 'MPM452-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
//         "    WHEN {custcol_rsm_item_tag} = 'SYDNEY PLUS BOURBON (P)' THEN 'SKP-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
//         "    ELSE REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
//         "  END " +
//         "ELSE " +
//         "  CASE " +
//         "    WHEN {custcol_rsm_item_tag} IN ('CONCORD / ELEGANT WHITE', 'ELEGANT WHITE') THEN 'EB10-' || {custcol_boomi_edi_item_name} " +
//         "    WHEN {custcol_rsm_item_tag} = 'CONCORD / ELEGANT OCEAN' THEN 'EB27-' || {custcol_boomi_edi_item_name} " +
//         "    WHEN {custcol_rsm_item_tag} LIKE 'ELEGANT PLUS%' THEN 'EBP-' || {custcol_boomi_edi_item_name} " +
//         "    WHEN {custcol_rsm_item_tag} = 'ROYAL WHITE' THEN 'L10-' || {custcol_boomi_edi_item_name} " +
//         "    WHEN {custcol_rsm_item_tag} = 'ROYAL SMOKY GREY' THEN 'L02-' || {custcol_boomi_edi_item_name} " +
//         "    WHEN {custcol_rsm_item_tag} = 'ROYAL MISTY GREY' THEN 'L03-' || {custcol_boomi_edi_item_name} " +
//         "    WHEN {custcol_rsm_item_tag} = 'ROYAL HARVEST' THEN 'L05-' || {custcol_boomi_edi_item_name} " +
//         "    WHEN {custcol_rsm_item_tag} = 'ROYAL ESPRESSO' THEN 'L11-' || {custcol_boomi_edi_item_name} " +
//         "    WHEN {custcol_rsm_item_tag} = 'BROADWAY' THEN 'BMM650-' || {custcol_boomi_edi_item_name} " +
//         //"    WHEN {custcol_rsm_item_tag} = 'MILANO' THEN 'MPM452-' || {custcol_boomi_edi_item_name} " +
//         "    WHEN {custcol_rsm_item_tag} = 'SYDNEY PLUS BOURBON (P)' THEN 'SKP-' || {custcol_boomi_edi_item_name} " +
//         "    ELSE {custcol_boomi_edi_item_name} " +
//         "  END " +
//         "END",
//     label: "Transformed Name"
// })

   
]
            }).run().getRange({ start: 0, end: 100 });

            for (var i = 0; i < results.length; i++) {
                var originalName = results[i].getValue({ name: 'custcol_boomi_edi_item_name' });
                var transformedName = results[i].getValue({ name: 'formulatext' });
                // log.debug('transformedName', transformedName)
                if (originalName && transformedName) {
                    resultMap[originalName] = transformedName;
                }
            }

            // Step 2: Load SO and update matching lines
            var rec = record.load({
                type: recType,
                id: soId,
                isDynamic: true
            });

            let is5P = rec.getValue('custbody_yy_so_5pdf');

            if (!is5P && recType == record.Type.ESTIMATE) return;

            var lineCount = rec.getLineCount({ sublistId: 'item' });

            for (var j = 0; j < lineCount; j++) {

                var itemId = rec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: j });

                if (context.type === context.UserEventType.EDIT && parseInt(itemId) !== 306263) continue;

                let productServiceId = rec.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_product_service_id',
                    line: j
                });

                let ediItemName = rec.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_boomi_edi_item_name',
                    line: j
                });

                let itemTag = rec.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_rsm_item_tag',
                    line: j
                });

                    let firstPart1 = ediItemName.split(' ')[0];
                    //let updatedName = firstPart + '-5P';
                    

                if (itemTag && firstPart1 && soId == 69446843) {
                      let spkItem1 = 'SKP-' + firstPart1;
                      let itemIdIs = getItemIdByName(spkItem1);
                        log.debug('itemIdIs', itemIdIs);

                        if (itemIdIs) {
                            rec.selectLine({ sublistId: 'item', line: j });
                            rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: itemIdIs });
                            rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'price', value: -1 });
                            rec.setCurrentSublistValue({
                                sublistId: 'item',
                                fieldId: 'rate',
                                value: rec.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: j })
                            });
                            rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_er_mod_cplus_stain', value: 1 });

                            rec.commitLine({ sublistId: 'item' });

                            // log.debug('No 5P Case', {
                            //     line: j,
                            //     fallbackValue: firstPart
                            // });

                        }
                    }
                if (itemTag && firstPart1 && soId == 69446643) {
                      let spkItem1 = 'SBP-' + firstPart1;
                      let itemIdIs = getItemIdByName(spkItem1);
                        log.debug('itemIdIs', itemIdIs);

                        if (itemIdIs) {
                            rec.selectLine({ sublistId: 'item', line: j });
                            rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: itemIdIs });
                            rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'price', value: -1 });
                            rec.setCurrentSublistValue({
                                sublistId: 'item',
                                fieldId: 'rate',
                                value: rec.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: j })
                            });
                            rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_yy_mod_cplus_color', value: 29 });

                            rec.commitLine({ sublistId: 'item' });

                            // log.debug('No 5P Case', {
                            //     line: j,
                            //     fallbackValue: firstPart
                            // });

                        }
                    }

                if (productServiceId == EDI_PRODUCT_SERVICE_ID && ediItemName) {

                    let firstPart = ediItemName.split(' ')[0];
                    let updatedName = firstPart + '-5P';
                    let spkItem = 'SKP-' + firstPart;
 
                    if (is5P) {

                        const itemExists = getItemIdByName(updatedName);

                        if (itemExists) {
                          
                           rec.selectLine({
                             sublistId: 'item',
                             line: j
                           });


                           rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: itemExists });
                           rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'price', value: -1 });
                           rec.setCurrentSublistValue({
                             sublistId: 'item',
                             fieldId: 'rate',
                             value: rec.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: j })
                           });

                          rec.commitLine({ sublistId: 'item' });
                        }


                        log.debug('Updated 5P Item Name', {
                            line: j,
                            oldName: ediItemName,
                            newName: updatedName
                        });
                    } 
                    else {

                        let itemIdIs = getItemIdByName(firstPart);

                        log.debug('itemIdIs', itemIdIs);

                        if (itemIdIs) {
                            rec.selectLine({ sublistId: 'item', line: j });
                            rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: itemIdIs });
                            rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'price', value: -1 });
                            rec.setCurrentSublistValue({
                                sublistId: 'item',
                                fieldId: 'rate',
                                value: rec.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: j })
                            });

                            rec.commitLine({ sublistId: 'item' });

                            log.debug('No 5P Case', {
                                line: j,
                                fallbackValue: firstPart
                            });

                        }

                    }

                    continue;
                }

                // if (parseInt(itemId) !== 306263) continue;

                // var ediItemName = rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_boomi_edi_item_name', line: j });
                // var transformedName = resultMap[ediItemName];
                var transformedName = ediItemName == 'PAN 3400' ? 'L03-PLY4X8' : resultMap[ediItemName];

                if (soId == '68910486') {
                  log.audit('edit name', transformedName);
                }

                if (!transformedName) continue;

                transformedName = transformedName.split(' ')[0];

                // var newItemId = getItemIdByName(transformedName);
                let newItemId;
                if (is5P) {
                    const transformedName5p = transformedName + '-5P';
                    const itemId = getItemIdByName(transformedName5p);

                    if (!itemId) {
                        newItemId = getItemIdByName(transformedName);
                    } else {
                        newItemId = itemId;
                    }
                } else {
                    newItemId = getItemIdByName(transformedName);
                }

                if (!newItemId) {
                    log.error('Item not found for transformed name', transformedName);
                    continue;
                }

                rec.selectLine({ sublistId: 'item', line: j });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: newItemId });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'price', value: -1 });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: rec.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: j }) });
                rec.commitLine({ sublistId: 'item' });

                log.debug('Updated line', {
                    line: j,
                    oldItemId: itemId,
                    newItemId: newItemId,
                    name: transformedName
                });
            }

            rec.save();
            log.audit('Sales Order updated with transformed items', soId);

        } catch (e) {
            log.error('Script Error', e);
        }
    }

    function getItemIdByName(name) {
        try {
            var res = search.create({
                type: search.Type.ITEM,
                filters: [['itemid', 'is', name]],
                columns: ['internalid']
            }).run().getRange({ start: 0, end: 1 });

            return res.length > 0 ? res[0].getValue('internalid') : null;
        } catch (e) {
            log.error('getItemIdByName error', e.message);
            return null;
        }
    }

    return {
        afterSubmit: afterSubmit
    };
});

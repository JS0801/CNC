/**
* @NApiVersion 2.1
* @NScriptType MapReduceScript
*/

define(['N/record', 'N/error','N/format', 'N/search', 'N/log', 'N/file', 'N/email', 'N/runtime'],
function(record, error,format,search,log, file, email, runtime) {
  
  function getInputData() {
    // Create the search
    return search.create({
      type: "file",
      filters: [
        ["folder", "anyof", "34218152", "34218154"]
      ],
      columns: [
        search.createColumn({ name: "internalid", sort: search.Sort.DESC, label: "Internal ID" })
      ]
    });
  }
  
  function map(context) {
    var fileId = context.key;
    log.debug('fileId', fileId)
    
    var fileObj = file.load({
      id: fileId
    });
    var fileContent = fileObj.getContents();
    var data = JSON.parse(fileContent);
    log.debug('data', data)
    
    try {
      
      var date = new Date();
      // Create a new quote (sales order) record
      var quote = record.create({
        type: record.Type.ESTIMATE, // Estimate corresponds to quote
        isDynamic: true,
      });
      
      var customer = getCustomerId(data.entity);
      log.debug('customer', customer)
      var customerId = customer.id;
      var dEmail = data.designerEmail;
      var location = customer.location
      var customer_Manager = getEmployeeId(customer.managerid);
      log.debug('customerId', customerId)
      log.debug('customer_Manager', customer_Manager)
      if (!customerId) {
        
        var emailBody = "Hi Team,<br/>Please review the customer details from the 2020 Quote creation.<br/>This customer is missing in the system.<br/><br/>";
        
        emailBody += "<table border='1' cellspacing='0' cellpadding='5' style='border-collapse:collapse;'>";
        emailBody += "<tr><th style='background:#f2f2f2;'>Customer Name</th><td colspan='4'>" + data.customer.name + "</td></tr>";
        emailBody += "<tr><th style='background:#f2f2f2;'>Address Type</th><th>Address</th><th>City</th><th>State</th><th>Zip</th></tr>";
        emailBody += "<tr><td style='background:#f2f2f2;'>Ship To</td><td>" + data.customer.shipTo.address + "</td><td>" + data.customer.shipTo.city + "</td><td>" + data.customer.shipTo.state + "</td><td>" + data.customer.shipTo.zip + "</td></tr>";
        emailBody += "<tr><td style='background:#f2f2f2;'>Bill To</td><td>" + data.customer.billTo.address + "</td><td>" + data.customer.billTo.city + "</td><td>" + data.customer.billTo.state + "</td><td>" + data.customer.billTo.zip + "</td></tr>";
        emailBody += "</table></br></br>";
        
        emailBody += "</br></br>Thank you,</br>CNC Cabinetry";
        
        log.debug('emailBody', emailBody)
        
        // email.send({
        //   author: [144846],
        //   recipients: [91522,124373,136201],
        //   subject: 'Quote Creation Error - Customer ' + data.customer["name"] + ' is missing',
        //   body: emailBody
        // });
        
        return false;
      }
      
      // Set body fields
    //  quote.setValue({ fieldId: 'customform', value: 211});
      quote.setValue({ fieldId: 'entity', value:  parseInt(customerId)});
      quote.setValue({ fieldId: 'subsidiary', value: 2 });
      quote.setValue({ fieldId: 'otherrefnum', value: data.PO || 'Test' });
      //quote.setValue({ fieldId: 'location', value: getLocationId(data.location) || 7 });
      quote.setValue({fieldId: 'location', value: location});
      quote.setValue({ fieldId: 'custbody_designer_email', value:  data.designerEmail });
      quote.setValue({ fieldId: 'entitystatus', value: getStatusId(data.entitystatus) || 10 }); // Proposal status
      quote.setValue({ fieldId: 'memo', value: data.memo });
      quote.setValue({ fieldId: 'custbody_cnc_payload_details', value: fileId });
      var alvicItem = false;
      
      // Add line items
      data.lines.items.forEach(function(item) {
      var itemid = getItemId(item.item);
      var code = item.item || '';
      var isRightOrLeftSuffix =
      code.slice(-2) === '-R' || code.slice(-2) === '-L';

        if (!isRightOrLeftSuffix) {
        if((item.item.indexOf("-POS") == -1 && !itemid) || itemid){
          quote.selectNewLine({ sublistId: 'item' });
        var desc = item.item;
        var itemName = (item.item).toLowerCase();
          log.debug('itemName', itemName)
          log.debug('itemid', itemid)
        if (itemName.indexOf("alvic") != -1) alvicItem = true;

        if (itemName.indexOf('|')!= -1) {
          item.item = itemName.split('|')[0];
        }

        
        if (itemid) quote.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: parseInt(itemid)});
        else {
          quote.setCurrentSublistValue({ 
            sublistId: 'item', 
            fieldId: 'item', 
            value: parseInt(309028)
          });
          quote.setCurrentSublistValue({ sublistId: 'item', fieldId: 'description', value: desc});
        }
        if(item.dstyle) quote.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_yy_mod_cplus_color', value: getInternalIdByName(item.dstyle) });
        quote.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_ds_2020_item_name', value: desc });
        quote.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: item.quantity });
        // quote.setCurrentSublistValue({ sublistId: 'item', fieldId: 'price', value: 97 });
        if (!itemid){
          quote.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: parseFloat(item.price) / parseFloat(item.quantity) });
          quote.setCurrentSublistValue({ sublistId: 'item', fieldId: 'amount', value: parseFloat(item.price) });
        }
       
        // quote.setCurrentSublistText({ sublistId: 'item', fieldId: 'taxcode', text: item.taxcode || "-Not Taxable-"});
        quote.commitLine({ sublistId: 'item' });
        }
        
        }

      });
      setAddress(quote, data.customer.billTo, data.customer.shipTo)

      // Save the quote and return the internal ID
      var quoteId = quote.save({ignoreMandatoryFields:true});
      var quoteRec = record.load({type: 'estimate', id: quoteId})
      var tranid = quoteRec.getValue({fieldId: 'tranid'})
      var custID = quoteRec.getText({fieldId: 'entity'})
      log.debug('New quoteId', quoteId)
      var fileObj = file.load({id: fileId})
      fileObj.folder = 34218153;
      fileObj.description = "New Quote Created -- id: " + quoteId;
      fileObj.save();

      if (quoteId) {

        setItemOptions(quoteId);
        log.debug('Email sending', customer_Manager)
        if (customer_Manager){
         log.debug('Email sending 2', customer_Manager)
        var baseUrl = "https://5387755-sb1.app.netsuite.com/app/accounting/transactions/estimate.nl?id=" + quoteId + "&whence=";

        var bodyEmail = "Dear " + customer.managerid + ",<br/><br/>";
        bodyEmail += tranid + " was created by Customer " + custID +" via 2020, and is ready in NetSuite.<br/><br/>";
        bodyEmail += "Please review this Quote and email it to the customer via NetSuite with the accurate Lead Times.";
        bodyEmail += "<br/><br/>Thank you";

        var bodyEmail2 = "A new quote has been successfully created in the CNC Cabinetry system.<br/><br/>Thanks,<br/>CNC Cabinetry"

        email.send({
          author: 144846,
          recipients: [customer_Manager],
          subject: 'Quote Created #' + tranid,
          body: bodyEmail
        });
          
        if (dEmail){
        email.send({
          author: 144846,
          recipients: [dEmail],
          subject: 'New Quote Created #' + tranid,
          body: bodyEmail2
        });
        }
log.debug('Email sent', 'Yes')
        }

        if (alvicItem){
          var itemList = data.lines.items;
          log.debug('itemList', itemList)

          var baseUrl = "https://5387755-sb1.app.netsuite.com/app/accounting/transactions/estimate.nl?id=59503975&whence=";
          var bodymsg = "Hi Chris Young, <br/><br/>";
          bodymsg += "Please review the new Quote which contains Alvic items.<br/>";
          bodymsg += "<a href='" + baseUrl + "' target='_blank' style='color:blue; text-decoration:underline;'>View Record</a><br/><br/>";

          // Start table
          bodymsg += "<table border='1' cellspacing='0' cellpadding='5' style='border-collapse:collapse;'>";
          bodymsg += "<tr><th style='background:#f2f2f2;'>Item Name</th><th>Quantity</th><th>Price</th></tr>";

          // Use a simple for loop to find ALVIC items
          for (var i = 0; i < itemList.length; i++) {
            var itemName = (itemList[i].item).toLowerCase();
            if (itemName.indexOf("alvic") !== -1) {  // indexOf instead of includes()
              bodymsg += "<tr><td>" + itemList[i].item + "</td><td>" + itemList[i].quantity + "</td><td>" + itemList[i].price + "</td></tr>";
            }
          }

          // Close table
          bodymsg += "</table>";

          bodymsg += "<br/>Thanks,<br/>CNC Cabinetry";


          email.send({
            author: 144846,
            recipients: [3610],
            subject: 'Quote Created for Alvic Item #' + tranid,
            body: bodymsg
          });
        }


      }
      
      return JSON.stringify({ success: true, msg: "New Quote Created -- id: " + quoteId });
      
    } catch (e) {
      var fileObj = file.load({id: fileId})
      fileObj.folder = 34218154;
      fileObj.description = e.message;
      fileObj.save();
      
      log.error({ title: 'Error creating quote', details: e });
      
      
      return JSON.stringify({ success: false, error: e.message });
    }
    
    
  }
  
  function reduce(context) {}
  
  function summarize(summary) {}

  function setAddress(transactionRecord, billto, shipto) {
      log.audit('Address', {
        billto, shipto
      })
      function put(rec, id, val){ if (val !== undefined && val !== null) rec.setValue({ fieldId: id, value: val }); }
      // if (billto.address){
      //   var ba = transactionRecord.getSubrecord({ fieldId: 'billingaddress' });
      //   put(ba, 'addr1',     billto.address     || '');
      //   put(ba, 'city',      billto.city        || '');
      //   put(ba, 'state',     billto.state       || '');    // e.g., 'TX'
      //   put(ba, 'zip',       billto.zip         || '');
      //   put(ba, 'addrphone', billto.phoneNumber || '');
      //   put(ba, 'country',   billto.country     || 'US');  // 2-letter country
      //   put(ba, 'override',  true               || '');
      // }

      if (shipto.address){
        var sa = transactionRecord.getSubrecord({ fieldId: 'shippingaddress' });
        put(sa, 'addr1',     shipto.address     || '');
        put(sa, 'city',      shipto.city        || '');
        put(sa, 'state',     shipto.state       || '');    // e.g., 'TX'
        put(sa, 'zip',       shipto.zip         || '');
        put(sa, 'addrphone', shipto.phoneNumber || '');
        put(sa, 'country',   shipto.country     || 'US');  // 2-letter country
        put(sa, 'override',  true               || '');
      }
      
    
  }
  
  function getInternalIdByName(name) {

    var colorMap = {
  "101 - Sleek White": 21,
  "102 - Linen": 22,
  "103 - Sahara": 114,
  "104 - Mountain Stream": 24,
  "105 - Adirondack Blue": 25,
  "106 - Sage": 26,
  "107 - Evergreen": 27,
  "108 - Rumors": 28,
  "Elegant Plus EBP108 Rumors (M)": 28,
  "109 - Cracked Pepper": 29,
  "110 - Jet Black": 30,
  "Custom": 113,
  "OLD 101 - Sage": 1,
  "OLD 102 - Evergreen": 2,
  "OLD 103 - Midnight Blue": 3,
  "OLD 104 - Jade": 4,
  "OLD 105 - Seafoam": 5,
  "OLD 106 - Linen": 6,
  "OLD 107 - Sahara": 7,
  "OLD 108 - Redend Point": 8,
  "OLD 109 - Clay": 9,
  "OLD 110 - Jet Black": 10,
  "OLD 103.2 - Sahara": 23,
  "Fashion Plus FBP106 Sage (N)": 115
};
  return colorMap[name] || null;
}

  // Helper function to get internal IDs for various fields
  function getCustomerId(entity) {

    var returnobject = {
        id: 85998,
        managerid: 'Tami Daniels'
      }

    var customerSearchObj = search.create({
      type: "customer",
      filters:
      [
        ["entityid","is",entity],
        "AND",
        ["isinactive","is","F"]
      ],
      columns:
      [
        search.createColumn({name: "internalid", label: "Internal ID"}),
        search.createColumn({name: "custentity_accountmanager", label: "custentity_accountmanager ID"}),
        search.createColumn({name: "custentitymb_warehouse_location", label: "custentitymb_warehouse_location"})
      ]
    });
    var searchResultCount = customerSearchObj.runPaged().count;
    log.debug("customerSearchObj result count",searchResultCount);
    customerSearchObj.run().each(function(result){

      returnobject = {
        id: result.getValue({name:'internalid'}),
        managerid: result.getValue({name:'custentity_accountmanager'}),
        location: result.getValue({name: 'custentitymb_warehouse_location'})
      }

        return true;
      });

      return returnobject;
    }

  function getEmployeeId(entity) {

    var object = '';

    var customerSearchObj = search.create({
      type: "employee",
      filters:
      [
        ["entityid","is",entity],
        "AND",
        ["isinactive","is","F"]
      ],
      columns:
      [
        search.createColumn({name: "internalid", label: "Internal ID"})
      ]
    });
    var searchResultCount = customerSearchObj.runPaged().count;
    log.debug("customerSearchObj result count",searchResultCount);
    customerSearchObj.run().each(function(result){


        object = result.getValue({name:'internalid'})


        return true;
      });

      return object;
    }

    function getLocationId(location) {


      var loc_obj = {
        "dropship": 13,
        "florida": 11,
        "nevada": 10,
        "new jersey": 7,
        "south carolina": 16,
        "texas": 12
      };

      // Convert input to lowercase for matching
      var locaID = loc_obj[location.toLowerCase()];

      return locaID !== undefined ? locaID : null; // Return null if location not found
    }

    function getStatusId(status) {

      var status_obj = {
        "closed lost": 14,
        "in discussion": 8,
        "identified decision makers": 9,
        "proposal": 10,
        "in negotiation": 11,
        "purchasing": 12
      };

      // Convert input to lowercase for matching
      var statusID = status_obj[status.toLowerCase()];

      return statusID !== undefined ? statusID : null; // Return null if status not found
    }

    function getItemId(item) {
      item = item.split("|")[0];
      if (item == 'CT-EDGEBAND') item = item + " 10%"
      var itemID = '';
      var assemblyitemSearchObj = search.create({
        type: "item",
        filters:
        [
          ["name","is",item],
          "AND",
          [["custitem_yy_availableso","is","T"],"OR",["type","anyof","Discount","Kit","Markup","NonInvtPart","OthCharge","Subtotal"]], 
          "AND", 
      ["custitem14","doesnotcontain","Check transactions"], 
      "AND", 
      ["isinactive","is","F"], 
      "AND", 
      ["custitem_mb_cncproductline","noneof","26"], 
      "AND", 
      ["custitem_mb_item_group","noneof","7"], 
      "AND",
      ["custitem_yy_launchdate","notafter","today"], 
      "AND", 
      ["custitem_yy_it_priceonly","is","F"]
        ],
        columns:
        [
          search.createColumn({name: "internalid", label: "Internal ID"})
        ]
      });
      var searchResultCount = assemblyitemSearchObj.runPaged().count;
      log.debug("assemblyitemSearchObj result count",{searchResultCount, item});
      assemblyitemSearchObj.run().each(function(result){

        itemID = result.getValue({name:'internalid'})
        return true;
      });
      log.debug('itemID', itemID)

      return itemID;
    }

    function setItemOptions(quoteId) {
  log.debug('Start setItemOptions', 'Quote ID: ' + quoteId);

  var estimateRec = record.load({
    type: record.Type.ESTIMATE,
    id: quoteId,
    isDynamic: true
  });
      estimateRec.setValue({ fieldId: 'customform', value: 143});

  var lineCount = estimateRec.getLineCount({ sublistId: 'item' });
  log.debug('Line Count', lineCount);

  var lastAssemblyLine = null;

  for (var i = 0; i < lineCount; i++) {
    estimateRec.selectLine({sublistId: 'item', line: i})
    var itemId = estimateRec.getCurrentSublistValue({
      sublistId: 'item',
      fieldId: 'item'
    });

    var itemtype = estimateRec.getCurrentSublistValue({
      sublistId: 'item',
      fieldId: 'itemtype'
    });

    log.debug('Line ' + i, 'Item ID: ' + itemId);

    if (itemtype == "Assembly" && itemId != 309028) {
      lastAssemblyLine = i;
      log.debug('Updated lastAssemblyLine', lastAssemblyLine);
    } else {
      var description = estimateRec.getCurrentSublistValue({
        sublistId: 'item',
        fieldId: 'custcol_ds_2020_item_name'
      });

      log.debug('Cut Item Found', 'Line: ' + i + ', Description: ' + description);

      if (description) {
        var fieldValue = '';
        var fieldId = '';
        if (description.indexOf("|") != -1) {
          fieldId = getFieldId(description.split("|")[0])
          fieldValue = description.split("|")[1];
          if (fieldValue.indexOf(",") != -1) {
            fieldValue = fieldValue.split(',')[0]
          }
        }else {
          fieldId = getFieldId(description)
        }
        
      //  if (fieldId == 'custcol_mb_so_finished_interior' || fieldId == 'custcol_yy_mod_chase' || fieldId == 'custcol_nk_mod_fulldepthshelf' || fieldId == 'custcol_yy_mod_sinkbase') fieldValue = 1;
        if (fieldId == 'custcol_yy_mod_cutdown') fieldValue = cut_Down_List(fieldValue);
        if (fieldId == 'custcol_mb_con_wall_cut_down_extend') fieldValue = wall_cut_Down_List(fieldValue);
        
        log.debug('Setting Values', { fieldId: fieldId, fieldValue: fieldValue });
        if (fieldValue && fieldId && lastAssemblyLine != null) {

          
        //  var cutText = cuttosize + '" DEEP';
          log.debug('fieldId ---  fieldValue', 'fieldId: ' + fieldId + ', fieldValue: ' + fieldValue);
          log.debug('Setting Cutdown Text', 'Line: ' + lastAssemblyLine + ', Value: ' + fieldValue);
          estimateRec.selectLine({sublistId: 'item', line: lastAssemblyLine});
          estimateRec.setCurrentSublistValue({
            sublistId: 'item',
            fieldId: fieldId,
            value: fieldValue 
          });
          estimateRec.commitLine({sublistId: 'item'})
        } else {
          log.debug('Skip setting', 'Missing');
        }
      } else {
        log.debug('No cuttosize found in description', description);
      }
    }
  }

  estimateRec.save({ enableSourcing: false, ignoreMandatoryFields: true });
  log.debug('End setItemOptions', 'Item options set successfully for Quote ID: ' + quoteId);
}

  function cut_Down_List(name){
    name = name + '" DEEP';
    var obj = {
      '21" DEEP': 1,
      '18" DEEP': 2,
      '15" DEEP': 3,
      '12" DEEP': 4,
      '9" DEEP': 5,
      '3" DEEP': 7,
    }

    return obj[name] || 1;
  }

  function wall_cut_Down_List(name){
    name = name + '" DEEP';
    var obj = {
      '24" DEEP': 1,
      '21" DEEP': 2,
      '18" DEEP': 3,
      '15" DEEP': 4,
      '9" DEEP': 6,
      '6" DEEP': 7,
    }

    return obj[name] || 1;
  }

  function getFieldId(itemname) {
    var fieldId = null;
    if (itemname == 'CT-FINISH-B' || itemname == 'CT-FINISH-W' || itemname == 'CT-FINISH-T') fieldId = 'custcol_mb_so_finished_interior';
    else if (itemname == 'CT-DCG' || itemname == 'CT-DCG-GLI' || itemname == 'CT-DCG-GLI-F') fieldId = 'custcol_mb_so_cut_for_glass';
    else if (itemname == 'CT-BCUT' || itemname == 'CT-DBCUT' || itemname == 'CT-TCUT' || itemname == 'CT-WCUT' || itemname == 'CT-TD-REDUCE') fieldId = 'custcol_yy_mod_cutdown';
    else if (itemname == 'CT-BCHASE' || itemname == 'CT-DBCHASE' || itemname == 'CT-TCHASE' || itemname == 'CT-WCHASE') fieldId = 'custcol_yy_mod_chase';
    else if (itemname == 'CT-HANDICUT' || itemname == 'CT-HANDICUTSHIP' || itemname == 'CT-TK-REDUCE' || itemname == 'CT-TKFLUSH') fieldId = 'custcol_yy_mod_toekick';
    else if (itemname == 'CHARGE-SINK-BASE') fieldId = 'custcol_yy_mod_sinkbase';
    else if (itemname == 'CT-SHELF-FD-B9' || itemname == 'CT-SHELF-FD-B12' || itemname == 'CT-SHELF-FD-B15' || itemname == 'CT-SHELF-FD-B18' || itemname == 'CT-SHELF-FD-B21' || itemname == 'CT-SHELF-FD-B24' || itemname == 'CT-SHELF-FD-B30' || itemname == 'CT-SHELF-FD-B33' || itemname == 'CT-SHELF-FD-B36' || itemname == 'CT-SHELF-FD-B39' || itemname == 'CT-SHELF-FD-B42' || itemname == 'CT-SHELF-FD-B48') fieldId = 'custcol_nk_mod_fulldepthshelf';
    else if (itemname.indexOf('CT-EXDW') != -1) fieldId = 'custcol_mb_con_wall_cut_down_extend';
    else if (itemname.indexOf('CT-WIDTHCUT') != -1) fieldId = 'custcol_er_mod_cutwidth';
    
    return fieldId;
  }
  
  return {
    getInputData: getInputData,
    map: map,
    reduce: reduce,
    summarize: summarize
  };
});
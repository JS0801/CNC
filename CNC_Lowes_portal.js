/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope Public
 *
 * =====================================================================
 *  LOWE'S CUSTOMER PORTAL  (External, Read-Only)
 * =====================================================================
 *  Customers enter their Purchase Order number and see the matching
 *  Sales Order in a clean, read-only layout.
 *
 *  SECURITY
 *  --------
 *  Every request must include ?apikey=<VALID_API_KEY> in the URL.
 *  Missing or wrong key  =>  404 "No Access"  (no other info leaked).
 *
 *  DEPLOYMENT
 *  ----------
 *  1. Upload this file to the File Cabinet.
 *  2. Create Script record (Suitelet) pointing to this file.
 *  3. Create Deployment, tick "Available Without Login"  => gives you
 *     an EXTERNAL URL.
 *  4. Give Lowe's the URL with the API key appended, e.g.:
 *     https://<acct>.app.netsuite.com/app/site/hosting/scriptlet.nl
 *        ?script=123&deploy=1&compid=XXX
 *        &apikey=LWS-A7X9K2M4P8Q1R5T3Y6U0I8O2E4W1Z9
 *  5. (Optional) Rotate the key by editing VALID_API_KEY below.
 * =====================================================================
 */
define(['N/search', 'N/record', 'N/log', 'N/runtime'],
function (search, record, log, runtime) {

    /* =============================================================
     *  >>> CHANGE THIS KEY TO ANY RANDOM STRING YOU WANT <<<
     *  Treat it like a password. Rotate on demand.
     * ============================================================= */



    /* =============================================================
     *  ENTRY POINT
     * ============================================================= */
    function onRequest(context) {
        var request  = context.request;
        var response = context.response;

        response.setHeader({ name: 'Content-Type',  value: 'text/html; charset=utf-8' });
        response.setHeader({ name: 'X-Frame-Options', value: 'SAMEORIGIN' });

          var VALID_API_KEY = runtime.getCurrentScript().getParameter({
            name: 'custscript_cnc_api_key'
          }) || '';

        try {
            /* ---------- 1. API-KEY GATE ---------- */
            var providedKey = request.parameters.token;
            if (!VALID_API_KEY || !providedKey || providedKey !== VALID_API_KEY) {
                log.audit({
                    title  : 'Portal: unauthorized access',
                    details: 'provided="' + (providedKey || '') + '"'
                });
                response.write({ output: render404() });
                return;
            }

            /* ---------- 2. ROUTE ---------- */
            var poNumber = (request.parameters.ponum || '').trim();

            if (!poNumber) {
                response.write({ output: renderSearchForm(providedKey) });
                return;
            }

            var so = lookupSalesOrder(poNumber);
            if (so) {
                response.write({ output: renderSalesOrder(so, providedKey, poNumber) });
            } else {
                response.write({ output: renderNotFound(poNumber, providedKey) });
            }

        } catch (e) {
            log.error({ title: 'Portal error', details: e });
            response.write({ output: renderError(request.parameters.apikey) });
        }
    }


    /* =============================================================
     *  DATA ACCESS
     * =============================================================
     *  Searches Sales Order by `otherrefnum` (the "PO/Check Number"
     *  field, which is where the customer's PO is stored).
     *  If your PO sits in a custom field, swap the filter below, e.g.
     *  ['custbody_lowes_po', 'is', poNumber]
     * ============================================================= */
    function lookupSalesOrder(poNumber) {
        var results = search.create({
            type   : search.Type.SALES_ORDER,
            filters: [
                ['mainline',    'is', 'T'],
                'AND',
                ['otherrefnum', 'is', poNumber]
            ],
            columns: ['internalid']
        }).run().getRange({ start: 0, end: 1 });

        if (!results || !results.length) return null;

        var rec = record.load({
            type     : record.Type.SALES_ORDER,
            id       : results[0].getValue('internalid'),
            isDynamic: false
        });

        var so = {
            id          : rec.id,
            tranid      : rec.getValue('tranid'),
            trandate    : rec.getText('trandate')   || rec.getValue('trandate'),
            ponum       : rec.getValue('otherrefnum'),
            customer    : rec.getText('entity'),
            status      : rec.getText('status'),
            subtotal    : toMoney(rec.getValue('subtotal')),
            discount    : toMoney(rec.getValue('discounttotal')),
            shippingcost: toMoney(rec.getValue('shippingcost')),
            tax         : toMoney(rec.getValue('taxtotal')),
            total       : toMoney(rec.getValue('total')),
            memo        : rec.getValue('memo'),
            shipaddress : rec.getValue('shipaddress'),
            billaddress : rec.getValue('billaddress'),
            shipmethod  : rec.getText('shipmethod'),
            terms       : rec.getText('terms'),
            items       : []
        };

        var lines = rec.getLineCount({ sublistId: 'item' });
        for (var i = 0; i < lines; i++) {
            so.items.push({
                item       : rec.getSublistText ({ sublistId:'item', fieldId:'item',        line:i }),
                description: rec.getSublistValue({ sublistId:'item', fieldId:'description', line:i }),
                quantity   : rec.getSublistValue({ sublistId:'item', fieldId:'quantity',    line:i }),
                units      : rec.getSublistText ({ sublistId:'item', fieldId:'units',       line:i }),
                rate       : toMoney(rec.getSublistValue({ sublistId:'item', fieldId:'rate',   line:i })),
                amount     : toMoney(rec.getSublistValue({ sublistId:'item', fieldId:'amount', line:i }))
            });
        }
        return so;
    }


    /* =============================================================
     *  HELPERS
     * ============================================================= */
    function toMoney(v) {
        if (v === null || v === undefined || v === '') return '0.00';
        var n = Number(v);
        if (isNaN(n)) return '0.00';
        return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function esc(s) {
        if (s === null || s === undefined) return '';
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function nl2br(s) { return esc(s).replace(/\r?\n/g, '<br>'); }

    function statusClass(status) {
        if (!status) return 'status-default';
        var s = status.toLowerCase();
        if (s.indexOf('closed')    > -1 || s.indexOf('cancel')    > -1) return 'status-closed';
        if (s.indexOf('billed')    > -1 || s.indexOf('fulfilled') > -1) return 'status-complete';
        if (s.indexOf('pending')   > -1 || s.indexOf('approval')  > -1) return 'status-pending';
        if (s.indexOf('partial')   > -1)                                return 'status-partial';
        return 'status-default';
    }


    /* =============================================================
     *  RENDERERS
     * ============================================================= */
    function pageShell(title, bodyHtml) {
        return '<!DOCTYPE html>\n'
+ '<html lang="en">\n'
+ '<head>\n'
+ '<meta charset="UTF-8">\n'
+ '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
+ '<title>' + esc(title) + '</title>\n'
+ '<style>\n'
+ '  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}\n'
+ '  body{font-family:"Segoe UI","Helvetica Neue",Arial,sans-serif;background:#f3f5f8;color:#222;min-height:100vh}\n'
+ '  a{color:#004990;text-decoration:none}a:hover{text-decoration:underline}\n'
+ '\n'
+ '  .topbar{background:#004990;color:#fff;padding:14px 32px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 2px 6px rgba(0,0,0,.15)}\n'
+ '  .topbar .brand{display:flex;align-items:center;gap:14px}\n'
+ '  .topbar .logo{background:#012169;color:#fff;font-weight:900;font-size:22px;padding:6px 14px;border-radius:4px;letter-spacing:2px;border:2px solid #fff}\n'
+ '  .topbar h1{font-size:16px;font-weight:400;opacity:.95}\n'
+ '  .topbar .sub{font-size:12px;opacity:.85}\n'
+ '\n'
+ '  .wrap{max-width:1100px;margin:30px auto;padding:0 20px}\n'
+ '\n'
+ '  .search-hero{background:linear-gradient(135deg,#004990 0%,#012169 100%);color:#fff;border-radius:10px;padding:40px 30px;box-shadow:0 8px 24px rgba(1,33,105,.25)}\n'
+ '  .search-hero h2{font-size:26px;margin-bottom:8px}\n'
+ '  .search-hero p{opacity:.9;margin-bottom:24px}\n'
+ '  .search-form{display:flex;gap:10px;flex-wrap:wrap}\n'
+ '  .search-form input[type=text]{flex:1;min-width:240px;padding:14px 16px;border:none;border-radius:6px;font-size:16px;color:#222}\n'
+ '  .search-form input[type=text]:focus{outline:3px solid #ffc220}\n'
+ '  .search-form button{padding:14px 28px;background:#ffc220;color:#012169;border:none;border-radius:6px;font-weight:700;font-size:15px;letter-spacing:.5px;cursor:pointer;transition:background .2s}\n'
+ '  .search-form button:hover{background:#ffd452}\n'
+ '\n'
+ '  .card{background:#fff;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.06);margin-top:20px;overflow:hidden}\n'
+ '  .card-header{background:#012169;color:#fff;padding:18px 24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}\n'
+ '  .card-header h3{font-size:18px;font-weight:600}\n'
+ '  .card-body{padding:24px}\n'
+ '\n'
+ '  .pill{display:inline-block;padding:5px 12px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase}\n'
+ '  .status-default {background:#e6eaf0;color:#012169}\n'
+ '  .status-pending {background:#fff4d6;color:#8a6d00}\n'
+ '  .status-partial {background:#e0f0ff;color:#004990}\n'
+ '  .status-complete{background:#dff5e3;color:#1b6b35}\n'
+ '  .status-closed  {background:#f0e0e0;color:#8a1f1f}\n'
+ '\n'
+ '  .meta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px 24px}\n'
+ '  .meta-item label{display:block;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px;font-weight:600}\n'
+ '  .meta-item .val{font-size:15px;color:#1f2937;font-weight:500;word-break:break-word}\n'
+ '  .meta-item .val.big{font-size:17px;font-weight:700;color:#012169}\n'
+ '\n'
+ '  .addr-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:24px}\n'
+ '  @media(max-width:640px){.addr-grid{grid-template-columns:1fr}}\n'
+ '  .addr-box{background:#f7f9fc;border:1px solid #e5e9f0;border-radius:8px;padding:16px}\n'
+ '  .addr-box h4{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px;font-weight:700}\n'
+ '  .addr-box p{font-size:14px;line-height:1.5;color:#1f2937}\n'
+ '\n'
+ '  .items{width:100%;border-collapse:collapse;margin-top:6px;font-size:14px}\n'
+ '  .items thead th{background:#f3f5f8;color:#012169;text-align:left;padding:12px 14px;font-size:11px;text-transform:uppercase;letter-spacing:.6px;border-bottom:2px solid #004990}\n'
+ '  .items tbody td{padding:12px 14px;border-bottom:1px solid #eef0f4;vertical-align:top}\n'
+ '  .items tbody tr:nth-child(even){background:#fbfcfe}\n'
+ '  .items tbody tr:hover{background:#f0f6ff}\n'
+ '  .items .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}\n'
+ '  .items .item-name{font-weight:600;color:#012169}\n'
+ '  .items .item-desc{color:#556070;font-size:13px;margin-top:3px}\n'
+ '\n'
+ '  .totals{margin-top:20px;margin-left:auto;width:100%;max-width:360px}\n'
+ '  .totals .row{display:flex;justify-content:space-between;padding:8px 0;font-size:14px}\n'
+ '  .totals .row.grand{border-top:2px solid #012169;margin-top:6px;padding-top:12px;font-size:18px;font-weight:700;color:#012169}\n'
+ '  .totals .money{font-variant-numeric:tabular-nums}\n'
+ '\n'
+ '  .notice{background:#fff;border-radius:10px;padding:40px 30px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.06);margin-top:20px}\n'
+ '  .notice .icon{font-size:48px;margin-bottom:12px}\n'
+ '  .notice h2{color:#012169;margin-bottom:8px}\n'
+ '  .notice p{color:#556070;margin-bottom:18px}\n'
+ '  .notice .back{display:inline-block;padding:10px 22px;background:#004990;color:#fff;border-radius:6px;font-weight:600;border:none;cursor:pointer;font-size:14px}\n'
+ '  .notice .back:hover{background:#012169;text-decoration:none}\n'
+ '\n'
+ '  .print-btn{background:transparent;color:#fff;border:1px solid #fff;padding:6px 14px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer}\n'
+ '  .print-btn:hover{background:#ffc220;color:#012169;border-color:#ffc220}\n'
+ '\n'
+ '  .footer{text-align:center;color:#8b95a5;font-size:12px;padding:28px 10px}\n'
+ '\n'
+ '  @media print{\n'
+ '    .topbar,.search-hero,.print-btn,.footer{display:none !important}\n'
+ '    body{background:#fff}\n'
+ '    .card{box-shadow:none;border:1px solid #ccc;page-break-inside:avoid}\n'
+ '  }\n'
+ '</style>\n'
+ '</head>\n'
+ '<body>\n'
+ bodyHtml + '\n'
+ '<div class="footer">&copy; ' + new Date().getFullYear() + ' Lowe\'s Companies, Inc. &nbsp;&middot;&nbsp; Customer Portal (Read-Only)</div>\n'
+ '</body></html>';
    }

    function topbar() {
        return '<div class="topbar">'
             +   '<div class="brand">'
             +     '<div class="logo">LOWE\'S</div>'
             +     '<div><h1>Customer Portal</h1><div class="sub">Order Tracking &amp; Status</div></div>'
             +   '</div>'
             + '</div>';
    }

    function renderSearchForm(apiKey) {
        var body = topbar()
                 + '<div class="wrap">'
                 +   '<div class="search-hero">'
                 +     '<h2>Track Your Order</h2>'
                 +     '<p>Enter your Purchase Order (PO) number below to view order details.</p>'
                 +     '<form class="search-form" method="POST">'
                 +       '<input type="hidden" name="apikey" value="' + esc(apiKey) + '">'
                 +       '<input type="text" name="ponum" placeholder="e.g. PO-12345678" required autofocus autocomplete="off">'
                 +       '<button type="submit">LOOK UP ORDER</button>'
                 +     '</form>'
                 +   '</div>'
                 + '</div>';
        return pageShell("Lowe's Customer Portal", body);
    }

    function renderNotFound(po, apiKey) {
        var body = topbar()
                 + '<div class="wrap">'
                 +   '<div class="notice">'
                 +     '<div class="icon">&#128269;</div>'
                 +     '<h2>No Order Found</h2>'
                 +     '<p>We couldn\'t locate a sales order for PO <strong>' + esc(po) + '</strong>.<br>Please verify the number and try again.</p>'
                 +     '<form method="POST" style="display:inline">'
                 +       '<input type="hidden" name="apikey" value="' + esc(apiKey) + '">'
                 +       '<button type="submit" class="back">&larr; Try Another PO</button>'
                 +     '</form>'
                 +   '</div>'
                 + '</div>';
        return pageShell('Order Not Found', body);
    }

    function renderError(apiKey) {
        var backBtn = apiKey
            ? '<form method="POST" style="display:inline">'
            + '<input type="hidden" name="apikey" value="' + esc(apiKey) + '">'
            + '<button type="submit" class="back">&larr; Back to Portal</button></form>'
            : '';
        var body = topbar()
                 + '<div class="wrap">'
                 +   '<div class="notice">'
                 +     '<div class="icon">&#9888;&#65039;</div>'
                 +     '<h2>Something Went Wrong</h2>'
                 +     '<p>We were unable to process your request. Please try again in a few moments.</p>'
                 +     backBtn
                 +   '</div>'
                 + '</div>';
        return pageShell('Error', body);
    }

    function renderSalesOrder(so, apiKey, originalPo) {
        var rows = '';
        if (!so.items.length) {
            rows = '<tr><td colspan="5" style="text-align:center;padding:20px;color:#6b7280">No line items on this order.</td></tr>';
        } else {
            for (var i = 0; i < so.items.length; i++) {
                var it = so.items[i];
                rows += '<tr>'
                     +   '<td>' + (i + 1) + '</td>'
                     +   '<td>'
                     +     '<div class="item-name">' + esc(it.item) + '</div>'
                     +     (it.description ? '<div class="item-desc">' + esc(it.description) + '</div>' : '')
                     +   '</td>'
                     +   '<td class="num">' + esc(it.quantity) + (it.units ? ' ' + esc(it.units) : '') + '</td>'
                     +   '<td class="num">$' + it.rate + '</td>'
                     +   '<td class="num">$' + it.amount + '</td>'
                     + '</tr>';
            }
        }

        var discountRow = '';
        if (parseFloat(String(so.discount).replace(/,/g, '')) !== 0) {
            discountRow = '<div class="row"><span>Discount</span><span class="money">$' + so.discount + '</span></div>';
        }

        var memoBlock = so.memo
            ? '<div style="margin-top:24px;padding:16px;background:#fffbe6;border-left:4px solid #ffc220;border-radius:4px">'
            + '<label style="display:block;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px;font-weight:600">Memo</label>'
            + '<div style="font-size:14px;color:#1f2937">' + nl2br(so.memo) + '</div>'
            + '</div>'
            : '';

        var body = topbar()
+ '<div class="wrap">'

/* compact re-search */
+   '<div class="search-hero" style="padding:20px 24px">'
+     '<form class="search-form" method="POST" style="margin:0">'
+       '<input type="hidden" name="apikey" value="' + esc(apiKey) + '">'
+       '<input type="text" name="ponum" placeholder="Enter another PO number..." value="' + esc(originalPo) + '" required>'
+       '<button type="submit">LOOK UP</button>'
+     '</form>'
+   '</div>'

/* summary card */
+   '<div class="card">'
+     '<div class="card-header">'
+       '<h3>Sales Order ' + esc(so.tranid) + '</h3>'
+       '<div style="display:flex;gap:10px;align-items:center">'
+         '<span class="pill ' + statusClass(so.status) + '">' + esc(so.status || 'N/A') + '</span>'
+         '<button class="print-btn" onclick="window.print()">&#128424;&nbsp;Print</button>'
+       '</div>'
+     '</div>'
+     '<div class="card-body">'
+       '<div class="meta-grid">'
+         '<div class="meta-item"><label>PO Number</label><div class="val big">' + esc(so.ponum) + '</div></div>'
+         '<div class="meta-item"><label>Order Number</label><div class="val">' + esc(so.tranid) + '</div></div>'
+         '<div class="meta-item"><label>Order Date</label><div class="val">' + esc(so.trandate) + '</div></div>'
+         '<div class="meta-item"><label>Customer</label><div class="val">' + esc(so.customer) + '</div></div>'
+         '<div class="meta-item"><label>Ship Method</label><div class="val">' + (esc(so.shipmethod) || '&mdash;') + '</div></div>'
+         '<div class="meta-item"><label>Payment Terms</label><div class="val">' + (esc(so.terms) || '&mdash;') + '</div></div>'
+       '</div>'
+       '<div class="addr-grid">'
+         '<div class="addr-box"><h4>Billing Address</h4><p>' + (nl2br(so.billaddress) || '<em>Not provided</em>') + '</p></div>'
+         '<div class="addr-box"><h4>Shipping Address</h4><p>' + (nl2br(so.shipaddress) || '<em>Not provided</em>') + '</p></div>'
+       '</div>'
+     '</div>'
+   '</div>'

/* items card */
+   '<div class="card">'
+     '<div class="card-header"><h3>Line Items (' + so.items.length + ')</h3></div>'
+     '<div class="card-body" style="padding:0 24px 24px">'
+       '<div style="overflow-x:auto">'
+       '<table class="items">'
+         '<thead><tr>'
+           '<th style="width:40px">#</th>'
+           '<th>Item</th>'
+           '<th class="num" style="width:120px">Qty</th>'
+           '<th class="num" style="width:120px">Rate</th>'
+           '<th class="num" style="width:140px">Amount</th>'
+         '</tr></thead>'
+         '<tbody>' + rows + '</tbody>'
+       '</table>'
+       '</div>'
+       '<div class="totals">'
+         '<div class="row"><span>Subtotal</span><span class="money">$' + so.subtotal + '</span></div>'
+         discountRow
+         '<div class="row"><span>Shipping</span><span class="money">$' + so.shippingcost + '</span></div>'
+         '<div class="row"><span>Tax</span><span class="money">$' + so.tax + '</span></div>'
+         '<div class="row grand"><span>Total</span><span class="money">$' + so.total + '</span></div>'
+       '</div>'
+       memoBlock
+     '</div>'
+   '</div>'
+ '</div>';

        return pageShell('Order ' + so.tranid + " - Lowe's Portal", body);
    }

    function render404() {
        return '<!DOCTYPE html>\n'
+ '<html lang="en"><head>\n'
+ '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n'
+ '<title>404 - No Access</title>\n'
+ '<style>\n'
+ '  *{box-sizing:border-box;margin:0;padding:0;font-family:"Segoe UI",Arial,sans-serif}\n'
+ '  body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1a1a1a 0%,#3d3d3d 100%)}\n'
+ '  .card{background:#fff;border-radius:12px;padding:50px 40px;text-align:center;max-width:440px;margin:20px;box-shadow:0 20px 60px rgba(0,0,0,.4)}\n'
+ '  .code{font-size:96px;font-weight:900;color:#c1272d;line-height:1;letter-spacing:-4px}\n'
+ '  h1{color:#222;margin:10px 0;font-size:24px}\n'
+ '  p{color:#666;font-size:14px;line-height:1.6}\n'
+ '</style></head><body>\n'
+ '  <div class="card">\n'
+ '    <div class="code">404</div>\n'
+ '    <h1>No Access</h1>\n'
+ '    <p>The page you are trying to reach does not exist or you are not authorized to view it.</p>\n'
+ '  </div>\n'
+ '</body></html>';
    }


    /* public exports */
    return { onRequest: onRequest };
});
import { lookupSchema } from './schemaLookup.js';

// ─── Schema sections — each exported individually so buildSchemaContext()
// can include only what a given query actually needs. ───────────────────────

const S_TRANSACTION = `
TRANSACTION TABLE (all transaction types share this table, differentiated by "type"):
transaction (id, type, trandate, tranid, entity, employee, subsidiary, foreigntotal,
             status, postingperiod, memo, department, class, location, currency,
             approvalstatus, duedate, otherrefnum, createdfrom, foreignamountunpaid)
AMOUNT: always use foreigntotal — NOT amount, NOT foreignamount. Example: t.foreigntotal > 10000
TYPE CODES: CustInvc=Invoice, SalesOrd=Sales Order, CustPymt=Customer Payment, CustCred=Credit Memo,
  VendBill=Vendor Bill, VendCred=Vendor Credit, VendPymt=Vendor Payment, PurchOrd=Purchase Order,
  Estimate=Quote, ItemRcpt=Item Receipt, ItemShip=Item Fulfillment, Journal=Journal Entry,
  Check=Check, Deposit=Deposit, ExpRept=Expense Report, InvAdjst=Inventory Adjustment,
  InvTrnfr=Inventory Transfer, RtnAuth=Return Authorization, CashSale=Cash Sale, CashRfnd=Cash Refund
STATUS: internal code — always use BUILTIN.DF(t.status) to display or filter.
  ══════════════════════════════════════════════════════════════════════
  STATUS FILTER RULE — READ THIS BEFORE WRITING ANY WHERE CLAUSE:
  DEFAULT = NO STATUS FILTER. Do NOT add any status filter unless the
  instruction contains one of these exact words: "open", "unbilled",
  "not billed", "not closed", "pending approval", "overdue".
  Saying "sales orders", "invoices", "vendor bills" alone → NO filter.
  Saying "large orders", "orders over $X", "recent orders" → NO filter.
  ONLY add a filter when the word "open" / "unbilled" / "pending" is
  literally present in the instruction.
  ══════════════════════════════════════════════════════════════════════
  When a filter IS required:
  SalesOrd open: BUILTIN.DF(t.status) LIKE '%Pending%'  ← use this positive filter; covers Pending Approval, Pending Fulfillment, Pending Billing/Partially Fulfilled, Pending Billing. NEVER use LIKE '%Open%' — it matches nothing. NEVER use NOT LIKE '%Billed%' — it incorrectly excludes "Pending Billing" statuses.
  CustInvc/VendBill: open=BUILTIN.DF(t.status) LIKE '%Open%', paid=LIKE '%Paid%'
  PurchOrd: active=LIKE '%Pending%', done=LIKE '%Closed%'`;

const S_TRANSACTIONLINE = `
TRANSACTIONLINE TABLE:
transactionline (transaction, linesequencenumber, item, quantity, rate, amount, netamount,
                 taxamount, department, class, location, account, entity, mainline, taxline,
                 isclosed, isfullyshipped, createdfrom)
mainline='T' = header/summary line (no item). mainline='F' = item detail lines.
taxline='T' = tax charge line. Use mainline='F' AND taxline='F' for item lines.
IMPORTANT: mainline is on transactionline, NEVER on transaction.
Item names: use BUILTIN.DF(tl.item) AS item_name — do NOT JOIN to item table (permission error).
  GROUP BY must repeat BUILTIN.DF(tl.item) without alias.
Journal entries: use transactionaccountingline instead of transactionline.`;

const S_CUSTOMER = `
CUSTOMER TABLE:
customer (id, entityid, companyname, email, phone, subsidiary, salesrep, terms, custtype,
          isperson, firstname, lastname, creditlimit, oncredithold, isinactive,
          datecreated, lastmodifieddate, balancesearch, overduebalancesearch, unbilledorderssearch)
Use balancesearch (not 'balance'), overduebalancesearch (not 'overduebalance').
Join: transaction.entity = customer.id`;

const S_VENDOR = `
VENDOR TABLE:
vendor (id, entityid, companyname, email, phone, subsidiary, terms, datecreated, isinactive)
Join: transaction.entity = vendor.id`;

const S_EMPLOYEE = `
EMPLOYEE TABLE:
employee (id, entityid, firstname, lastname, email, department, subsidiary, issalesrep, title, hiredate)
Always LEFT OUTER JOIN — some transactions have no employee.`;

const S_ITEM = `
ITEM TABLE (only join if you need salesprice/baseprice/itemtype — otherwise use BUILTIN.DF):
item (id, itemid, displayname, itemtype, salesprice, baseprice, incomeaccount, assetaccount, subsidiary, isinactive)
itemtype: 'InvtPart','NonInvtPart','Service','Assembly','Kit','OthCharge','Group'
itemprice (item, pricelevelname, price, isinactive) — LEFT OUTER JOIN`;

const S_ACCOUNTING = `
ACCOUNTING TABLES:
account (id, acctnumber, acctname, accttype, parent, subsidiary, currency)
  accttype: 'Bank','AcctRec','OthCurrAsset','FixedAsset','AcctPay','CreditCard','LongTermLiab','Equity','Income','COGS','Expense','OthIncome','OthExpense'
accountingperiod (id, periodname, startdate, enddate, isyear, isquarter, isadjust, closed)
transactionaccountingline (transaction, account, amount, credit, debit) — use for journal entries`;

const S_LINKING = `
LINKING TABLES:
nexttransactionlink (previousdoc, nextdoc) — links PO→receipt→bill. JOIN: nl.previousdoc = t.id
previoustransactionlinelink (nextdoc, nextline, previousdoc, previousline, linktype, foreignamount)
  linktype='Payment' for payment applications`;

const S_CLASSIFICATION = `
CLASSIFICATION TABLES:
department/class/location/subsidiary (id, name, parent, subsidiary)
opportunity (id, entity, title, expectedclosedate, probability, projectedamount, salesrep, status, subsidiary)
supportcase (id, casenumber, title, status, priority, assigned, customer, startdate, enddate)`;

const S_SYNTAX = `
SUITEQL SYNTAX RULES:
- Oracle SQL dialect. Always alias columns explicitly.
- Booleans: 'T'/'F' (not TRUE/FALSE). Never SELECT *.
- ROWNUM limit: simple→ WHERE ROWNUM <= N. With GROUP BY → wrap in subquery: SELECT * FROM (...GROUP BY...ORDER BY...) WHERE ROWNUM <= N
- BUILTIN.DF(field) → display value of any coded/foreign-key field
- Dates: SYSDATE=today, TRUNC(date,'MONTH'/'Q'/'YEAR'), ADD_MONTHS(SYSDATE,-3), (SYSDATE-30)=30 days ago
- Date filtering: NEVER use YEAR() or MONTH() functions — not valid in SuiteQL. Use TRUNC instead: TRUNC(t.trandate,'YEAR')=TRUNC(SYSDATE,'YEAR') for "this year", TRUNC(t.trandate,'MONTH')=TRUNC(SYSDATE,'MONTH') for "this month"
- Revenue aggregation: use SUM(t.foreigntotal) on the transaction table directly — no transactionline join needed for totals
- String concat: || operator. UPPER/LOWER/TRIM/SUBSTR/LENGTH/REPLACE supported.
- LEFT OUTER JOIN whenever relationship may not always exist.
- CASE WHEN...THEN...ELSE...END supported.`;

// Example queries tagged by relevance keywords
const EXAMPLES = [
  {
    tags: ['invoice', 'custinvc', 'ar', 'receivable', 'open invoice'],
    sql: `-- Open invoices:
SELECT t.tranid, t.trandate, c.companyname, t.foreigntotal AS amount, BUILTIN.DF(t.status) AS status
FROM transaction t JOIN customer c ON t.entity = c.id
WHERE t.type = 'CustInvc' AND BUILTIN.DF(t.status) LIKE '%Open%' ORDER BY t.trandate DESC`,
  },
  {
    tags: ['open order', 'unbilled', 'open sales order', 'not billed', 'pending fulfillment'],
    sql: `-- Open/unbilled sales orders only (use status filter ONLY when instructions say "open" or "not billed"):
SELECT t.id AS txn_id, t.tranid, t.trandate, t.entity AS entity_id, BUILTIN.DF(t.entity) AS customer, t.foreigntotal AS amount, BUILTIN.DF(t.status) AS status
FROM transaction t
WHERE t.type = 'SalesOrd' AND BUILTIN.DF(t.status) LIKE '%Pending%'
ORDER BY t.trandate DESC`,
  },
  {
    tags: ['sales order', 'salesord', 'all sales orders', 'sales orders over'],
    sql: `-- All sales orders (no status filter — use when instruction does not say "open" or "unbilled"):
SELECT t.id AS txn_id, t.tranid, t.trandate, t.entity AS entity_id, BUILTIN.DF(t.entity) AS customer, t.foreigntotal AS amount, BUILTIN.DF(t.status) AS status
FROM transaction t
WHERE t.type = 'SalesOrd'
ORDER BY t.trandate DESC`,
  },
  {
    tags: ['vendor bill', 'vendbill', 'payable', 'ap', 'due'],
    sql: `-- Vendor bills due soon:
SELECT t.tranid, t.trandate, t.duedate, BUILTIN.DF(t.entity) AS vendor, t.foreigntotal AS amount, BUILTIN.DF(t.status) AS status
FROM transaction t
WHERE t.type = 'VendBill' AND BUILTIN.DF(t.status) LIKE '%Open%' AND t.duedate BETWEEN SYSDATE AND ADD_MONTHS(SYSDATE,1)
ORDER BY t.duedate`,
  },
  {
    tags: ['customer balance', 'overdue', 'ar balance', 'balance'],
    sql: `-- Customers with overdue balances:
SELECT companyname, entityid, balancesearch AS open_balance, overduebalancesearch AS overdue
FROM customer WHERE balancesearch > 0 AND isinactive = 'F' ORDER BY overduebalancesearch DESC`,
  },
  {
    tags: ['line item', 'item', 'product', 'quantity', 'transactionline'],
    sql: `-- Invoice line items (BUILTIN.DF for item name — no item table join):
SELECT t.tranid, BUILTIN.DF(tl.item) AS item_name, tl.quantity, tl.rate, tl.amount
FROM transaction t JOIN transactionline tl ON tl.transaction = t.id AND tl.mainline = 'F' AND tl.taxline = 'F'
JOIN customer c ON t.entity = c.id WHERE t.type = 'CustInvc' AND tl.item IS NOT NULL`,
  },
  {
    tags: ['top', 'group by', 'aggregate', 'top items', 'best selling', 'by item'],
    sql: `-- Top N items with GROUP BY (subquery required for ROWNUM):
SELECT * FROM (
  SELECT BUILTIN.DF(tl.item) AS item_name, SUM(tl.quantity) AS qty, SUM(tl.amount) AS total
  FROM transaction t JOIN transactionline tl ON tl.transaction = t.id AND tl.mainline = 'F' AND tl.taxline = 'F'
  WHERE t.type = 'CustInvc' AND tl.item IS NOT NULL GROUP BY BUILTIN.DF(tl.item) ORDER BY total DESC
) WHERE ROWNUM <= 10`,
  },
  {
    tags: ['revenue', 'monthly', 'by month', 'revenue by month', 'monthly revenue', 'sales by month', 'revenue this year', 'revenue trend'],
    sql: `-- Monthly revenue this year (transaction table only — no transactionline join needed):
SELECT * FROM (
  SELECT TRUNC(t.trandate, 'MONTH') AS month, SUM(t.foreigntotal) AS revenue
  FROM transaction t
  WHERE t.type = 'CustInvc'
    AND TRUNC(t.trandate, 'YEAR') = TRUNC(SYSDATE, 'YEAR')
  GROUP BY TRUNC(t.trandate, 'MONTH')
  ORDER BY month
) WHERE ROWNUM <= 500`,
  },
  {
    tags: ['revenue by quarter', 'quarterly revenue', 'by quarter', 'quarter'],
    sql: `-- Quarterly revenue (use TRUNC with QUARTER — no transactionline needed):
SELECT * FROM (
  SELECT TRUNC(t.trandate, 'Q') AS quarter, SUM(t.foreigntotal) AS revenue
  FROM transaction t
  WHERE t.type = 'CustInvc'
    AND TRUNC(t.trandate, 'YEAR') = TRUNC(SYSDATE, 'YEAR')
  GROUP BY TRUNC(t.trandate, 'Q')
  ORDER BY quarter
) WHERE ROWNUM <= 500`,
  },
  {
    tags: ['purchase order', 'purchord', 'po', 'receipt', 'related'],
    sql: `-- PO and related docs:
SELECT t.tranid AS po, BUILTIN.DF(t.entity) AS vendor, t2.tranid AS related_doc, BUILTIN.DF(t2.type) AS doc_type
FROM transaction t JOIN nexttransactionlink nl ON nl.previousdoc = t.id JOIN transaction t2 ON t2.id = nl.nextdoc
WHERE t.type = 'PurchOrd' ORDER BY t.trandate DESC`,
  },
  {
    tags: ['employee', 'sales rep', 'rep', 'staff'],
    sql: `-- Sales orders with rep (LEFT JOIN — employee may be null):
SELECT t.tranid, BUILTIN.DF(t.entity) AS customer, e.firstname || ' ' || e.lastname AS rep, t.foreigntotal AS amount
FROM transaction t LEFT OUTER JOIN employee e ON e.id = t.employee
WHERE t.type = 'SalesOrd' ORDER BY t.trandate DESC`,
  },
];

function pickExamples(text) {
  const t = text.toLowerCase();
  const scored = EXAMPLES.map(ex => ({
    ex,
    score: ex.tags.filter(tag => t.includes(tag)).length,
  })).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  // Return at most 3 most-relevant examples
  return scored.slice(0, 3).map(x => x.ex.sql).join('\n\n');
}

/**
 * Build a minimal schema context for the given text (question or instructions).
 * Combines hand-curated rules + real field definitions from the imported NetSuite schema.
 * The live schema lookup adds real column names/types for tables matched by keyword.
 */
export function buildSchemaContext(text) {
  const t = text.toLowerCase();
  const sections = [S_TRANSACTION]; // always needed

  if (/\b(line.item|transactionline|item|product|quantity|rate|sku|mainline|taxline|fulfil)\b/.test(t)) {
    sections.push(S_TRANSACTIONLINE);
  }
  if (/\b(customer|client|company|entity|ar|receivable|balance|credit.hold|contact)\b/.test(t)) {
    sections.push(S_CUSTOMER);
  }
  if (/\b(vendor|supplier|bill|payable|ap)\b/.test(t)) {
    sections.push(S_VENDOR);
  }
  if (/\b(employee|rep|sales.rep|staff|person|assigned)\b/.test(t)) {
    sections.push(S_EMPLOYEE);
  }
  if (/\b(item.type|sale.price|base.price|inventory|sku|kit|assembly)\b/.test(t)) {
    sections.push(S_ITEM);
  }
  if (/\b(account|gl|journal|debit|credit|ledger|period|fiscal)\b/.test(t)) {
    sections.push(S_ACCOUNTING);
  }
  if (/\b(related|linked|receipt|fulfil|next.trans|previous.trans|payment.appl)\b/.test(t)) {
    sections.push(S_LINKING);
  }
  if (/\b(department|class|location|subsidiary|address|opportunity|case|support)\b/.test(t)) {
    sections.push(S_CLASSIFICATION);
  }

  sections.push(S_SYNTAX);

  const examples = pickExamples(t);
  if (examples) sections.push('EXAMPLES:\n' + examples);

  // Append live schema reference (real field names from imported NetSuite schema)
  const liveSchema = lookupSchema(text);
  if (liveSchema) sections.push(liveSchema);

  return sections.join('\n').trim();
}

// Full schema — kept for any code that still needs the complete reference
export const SUITEQL_SCHEMA_CONTEXT = [
  S_TRANSACTION, S_TRANSACTIONLINE, S_CUSTOMER, S_VENDOR, S_EMPLOYEE,
  S_ITEM, S_ACCOUNTING, S_LINKING, S_CLASSIFICATION, S_SYNTAX,
  'EXAMPLES:\n' + EXAMPLES.map(e => e.sql).join('\n\n'),
].join('\n').trim();

# My Little Shop — Phase 2.5

This version deliberately stays **front-end only**:

- HTML
- CSS
- JavaScript
- browser `localStorage`

There is **no database, server-side code, API, authentication server, or backend**.

## What was corrected

### Data and inventory
- Added schema versioning and normalization.
- Added migration from the previous `myLittleShopData_v3` localStorage key.
- Product IDs use collision-resistant IDs where supported.
- Stock quantities are whole numbers.
- Restocking adds a **new FIFO cost layer**. Sales consume the oldest remaining layer first, and each sale snapshots the actual cost layers consumed.
- Stock movements are recorded for opening stock, restocks, sales and sale reversals.
- Selling price and cost are kept separate.
- Sales snapshot product name, selling price and cost at the moment of sale, so later price/cost changes do not rewrite historical profit.

### Sales
- Search works.
- Payment filter works.
- Completed/voided status filter works.
- Sale quantity is validated against current stock.
- Sale writes stock and sale history together through one state update.
- Sales are **voided/reversed**, not deleted. A reason is required and stock is restored.
- Historical sale records retain the original unit price and unit cost.

### Dates and reporting
- Business dates use the browser's local date instead of `toISOString().slice(0, 10)`.
- Dashboard clearly says **Revenue Today** rather than calling it total revenue.
- Income totals use completed sales.
- The 7-day chart is now calculated from actual completed sales.
- Drawing entry count is stored instead of being hard-coded.
- Sample drawing data has been removed.

### UI and accessibility
- Added a missing `styles.css`.
- Added the missing Stock page.
- Added a Settings page.
- Corrected table column counts.
- Replaced fragile DOM index lookups with explicit IDs.
- Added modal focus handling and Escape-to-close.
- Added inline validation messages/toasts.
- Added responsive styling.
- Removed misleading static sample values.

### Data protection
- Added JSON export/import.
- Added a clear-data action with confirmation.
- Added local audit records for important changes.

## Important localStorage limitation

This app is suitable for a single-browser/local workflow, but browser storage is not a database.

Data can be lost if:
- site/browser storage is cleared;
- browser profiles are changed;
- private browsing data is removed;
- storage limits are reached;
- a user imports bad data.

Use **Settings → Export JSON backup** regularly.

## Costing note

This application currently uses FIFO inventory costing. Confirm that FIFO matches the shop’s bookkeeping requirements before relying on reports for formal accounting.

## Future database migration

When the project eventually moves server-side, the local model already separates:
- products
- sales
- stock movements
- drawings
- settings
- audit events

That structure can later map to database tables/collections without changing the business concepts.

The next server-side phase should also introduce:
- authenticated users and roles;
- server-side validation;
- atomic database transactions;
- persistent audit history;
- backups and recovery;
- proper concurrent stock updates;
- database-level constraints and indexes.


## Phase 3 usability improvements

- Added an Expenses page with categories, payment method, date, description and CSV export.
- Dashboard now shows stock value at recorded cost, expenses today, a low-stock action list and daily cash closing.
- Added cash reconciliation: expected cash is cash sales less recorded cash expenses for the selected business date; the actual counted amount and variance are retained.
- Stock page now supports product search, stock-status filters, stock valuation, CSV export and print layout.
- Sales and expense records can be exported as CSV; reports have print-friendly styling.
- Income summary includes recorded expenses and an estimated profit after expenses.
- Added schema migration defaults for expense and daily-closing arrays, preserving existing local data.

### Important accounting note

“Profit after expenses” currently subtracts all recorded expenses from all completed-sales gross profit; it is a simple overview, not a formal accounting statement. Record operating expenses consistently. Stock purchases should be tracked through restocking and recognized as cost of goods sold as inventory is sold. Credit sales are recorded as sales but should not be treated as cash received for cash reconciliation.

### Validation

This remains a single-browser front-end application. Browser storage can be cleared or lost, and the cash closing assumes all relevant cash sales and cash expenses are entered. Back up from Settings before importing, resetting or clearing data.

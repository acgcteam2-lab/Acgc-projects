import { FileText, X } from "lucide-react";
import logo from "@/assets/images/ACGCLOGO1.png";
import approvedStamp from "@/assets/approved.png";
import { formatDateToMMMDDYYYY } from "@/lib/dateUtils";
import { getFinalProjectCost, getRequiredDownpayment } from "@/lib/orderPricing";
import { getContractBladeDetails } from "@/pages/SiteInspection/contractState";

function ContractModal({ isOpen, onClose, inspection, contractData, onAccept, onDecline, onRegenerate, isLoading, actionError, onDownload, onDownloadPNG, onPrint, onSendToCustomer, isSendingToCustomer = false, notificationRecordId = null, darkMode = false, transparentBackdrop = false, acceptedOverride, awaitingResponseOverride }) {
  if (!isOpen || !inspection || !contractData) return null;

  const formatCurrency = (value) => new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);

  const shellClass = darkMode
    ? "mobile-fullscreen-dialog flex max-h-[94vh] w-[min(100%,900px)] flex-col overflow-hidden rounded-2xl border border-slate-600 bg-[#0d1f2f] shadow-2xl"
    : "mobile-fullscreen-dialog flex max-h-[94vh] w-[min(100%,900px)] flex-col overflow-hidden rounded-2xl bg-slate-100 shadow-2xl";
  const headerClass = darkMode ? "sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-slate-600 bg-[#11293a] px-4 py-3" : "sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3";
  const titleClass = darkMode ? "text-xl font-bold text-slate-100" : "text-xl font-bold text-slate-900";
  const buttonShellClass = darkMode ? "rounded-lg border border-slate-600 bg-[#1b3045] px-3 py-2 text-sm text-slate-100 hover:bg-[#233d57]" : "rounded-lg border bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50";
  const closeButtonClass = darkMode ? "rounded-lg p-2 text-slate-200 hover:bg-slate-700" : "rounded-lg p-2 text-slate-600 hover:bg-slate-100";
  const contentClass = darkMode ? "relative mx-auto my-2 w-full max-w-[890px] overflow-y-auto bg-[#10283b] px-2.5 py-3 text-[12px] text-slate-100 shadow-sm" : "relative mx-auto my-2 w-full max-w-[890px] overflow-y-auto bg-white px-2.5 py-3 text-[12px] text-slate-800 shadow-sm";
  const infoCardClass = darkMode ? "mb-4 grid grid-cols-2 gap-2 rounded-xl border border-slate-600 bg-[#132f46] p-2.5 text-[10px] text-slate-200" : "mb-4 grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-[10px] text-slate-700";
  const infoLabelClass = darkMode ? "font-black uppercase tracking-[0.14em] text-red-300" : "font-black uppercase tracking-[0.14em] text-[#5c1118]";
  const infoValueClass = darkMode ? "mt-1 font-bold text-white" : "mt-1 font-bold text-slate-900";
  const noticeClass = darkMode ? "mb-4 rounded-xl border border-amber-400/40 bg-amber-500/15 px-4 py-3 text-sm text-amber-100" : "mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800";
  const sectionLabelClass = darkMode ? "text-[10px] font-black uppercase tracking-[0.14em] text-red-300" : "text-[10px] font-black uppercase tracking-[0.14em] text-[#5c1118]";
  const tableTopClass = darkMode ? "bg-[#6b2430] text-white" : "bg-[#5c1118] text-white";
  const subtleTextClass = darkMode ? "text-slate-300" : "text-slate-500";
  const subtleTextDarkClass = darkMode ? "text-slate-200" : "text-slate-600";
  const panelClass = darkMode ? "rounded border border-slate-600 bg-[#132f46] p-4" : "rounded border border-[#e3b7b7] p-4";
  const minorPanelClass = darkMode ? "rounded border border-emerald-500/40 bg-[#113a39] p-3 text-[10px] text-emerald-100" : "rounded border border-emerald-200 bg-emerald-50 p-3 text-[10px]";
  const footerClass = darkMode ? "mt-6 border-t border-slate-600 pt-4 text-center text-[9px] text-slate-300" : "mt-6 border-t border-slate-200 pt-4 text-center text-[9px] text-slate-500";

  const formatDate = (value, fallback = "N/A") => {
    if (!value) return fallback;
    return formatDateToMMMDDYYYY(value) || value;
  };

  const orderStatus = String(contractData.orderStatus || inspection.status || contractData.status || "").toLowerCase();
  const contractStatus = String(contractData.rawContractStatus || contractData.contractStatus || inspection.contract_status || "").toLowerCase();
  const isAccepted = acceptedOverride ?? (orderStatus === "contract_accepted" || contractStatus === "accepted");
  const isAwaitingCustomerResponse = awaitingResponseOverride ?? (orderStatus === "contract_sent" || (orderStatus === "site_inspection" && contractStatus === "sent") || contractStatus === "sent");
  const isWalkInCustomer = inspection.order_type === "walk_in_customer" || inspection.acceptance_method === "walk_in_signed_contract";
  const actionsAllowed = Boolean(onAccept || onDecline) && isAwaitingCustomerResponse && !isAccepted && !isWalkInCustomer;
  const totalAmount = getFinalProjectCost({ ...inspection, ...contractData, final_project_cost: inspection.final_project_cost });
  const isFullPaymentMethod = String(inspection.payment_terms || "").trim() === "full_payment";
  const downPayment = getRequiredDownpayment({ ...inspection, ...contractData, final_project_cost: totalAmount });
  const contractItems = contractData.items || [];
  const sourceItems = inspection.items || [];
  const getItemWarrantyPeriod = (item, index) => (
    item.warrantyPeriod ?? sourceItems[index]?.warranty_period ?? inspection.warranty_period
  );
  const itemWarrantyPeriods = contractItems.map((item, index) => getItemWarrantyPeriod(item, index));
  const hasDifferentItemWarranties = new Set(itemWarrantyPeriods.map((period) => String(period ?? ""))).size > 1;
  const isPerProductWarranty = contractItems.length > 1 && (
    inspection.warranty_assignment_mode === "per_product" || hasDifferentItemWarranties
  );
  const isNoWarranty = inspection.warranty_period === "No Warranty";
  const hasCustomWarranty = !isNoWarranty && (inspection.warranty_period === "Custom" || (
    Number.isFinite(Number(inspection.warranty_period)) &&
    Number(inspection.warranty_period) > 0 &&
    ![30, 90].includes(Number(inspection.warranty_period))
  ));
  const warrantyPeriod = hasCustomWarranty
    ? Number(inspection.custom_warranty_days || inspection.warranty_period || 90)
    : Number(inspection.warranty_period ?? inspection.custom_warranty_days ?? 90) || 90;
  const warrantyPeriodLabel = isPerProductWarranty
    ? "Assigned per product below"
    : isNoWarranty ? "No Warranty" : `${warrantyPeriod} days`;
  const getItemWarrantyDetails = (item, index) => {
    const sourceItem = sourceItems[index] || {};
    const period = getItemWarrantyPeriod(item, index);
    const customDays = item.warrantyCustomDays ?? sourceItem.custom_warranty_days ?? inspection.custom_warranty_days;
    const periodText = period === "No Warranty"
      ? "No Warranty"
      : period === "Custom"
        ? `${Number(customDays) || 90} days`
        : Number.isFinite(Number(period))
          ? `${Number(period)} days`
          : String(period || `${warrantyPeriod} days`);
    const start = item.warrantyStartDate ?? sourceItem.warranty_start_date;
    const expiry = item.warrantyExpiryDate ?? sourceItem.warranty_expiry_date;
    return { periodText, start, expiry, hasCoverage: period !== "No Warranty" };
  };
  const inspectionDate = contractData.siteInspectionDate || formatDate(inspection.inspection_date, "TBD");
  const installationDate = formatDate(inspection.estimated_installation_date, "TBD");
  const customerName = contractData.customerName || inspection.customer_name || "Customer";
  const customerEmail = contractData.customerEmail || inspection.customer_email || "N/A";
  const customerPhone = contractData.customerPhone || inspection.customer_phone || "N/A";
  const siteAddress = contractData.projectLocation || inspection.shipping_address || "N/A";
  const paymentTerms = contractData.paymentTerms || inspection.payment_terms || (isFullPaymentMethod
    ? "Full payment is required before project commences."
    : "50% downpayment, 50% upon completion");
  const siteNotes = inspection.inspection_notes || inspection.site_notes || "No additional site notes provided.";
  const paymentReceivedLabel = isFullPaymentMethod ? "Full Payment Required" : "Required Downpayment";
  const balanceLabel = isFullPaymentMethod ? "Balance Due" : "Balance Upon Completion";
  const agreedPaymentDate = contractData.agreedPaymentDate || formatDate(inspection.agreed_payment_date, null);

  return (
    <div className={`${transparentBackdrop ? "customer-modal-overlay" : ""} mobile-fullscreen-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-1.5`}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Service Contract"
        data-notification-record-id={notificationRecordId || undefined}
        data-notification-target={notificationRecordId ? "contract" : undefined}
        className={`${shellClass} ${notificationRecordId ? "notification-target-highlight" : ""}`}
      >
        <div className={headerClass}>
          <div>
            <h2 className={titleClass}>Service Contract</h2>
            {actionError && <p className={`mt-1 text-sm font-medium ${darkMode ? "text-red-300" : "text-red-600"}`}>{actionError}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onDownload && (
              <button type="button" onClick={onDownload} className={`${buttonShellClass} inline-flex items-center gap-2`}>
                <FileText size={15} />
                Download PDF
              </button>
            )}
            {onDownloadPNG && <button type="button" onClick={onDownloadPNG} className={buttonShellClass}>Download PNG</button>}
            {onPrint && <button type="button" onClick={onPrint} className={buttonShellClass}>Print Contract</button>}
            {onRegenerate && contractData.contractNeedsRegeneration && !isAccepted && (
              <button type="button" onClick={onRegenerate} disabled={isLoading} className={`${buttonShellClass} disabled:cursor-not-allowed disabled:opacity-60`}>
                Generate New Version
              </button>
            )}
            {onSendToCustomer && !isAccepted && (
              <button type="button" onClick={onSendToCustomer} disabled={isSendingToCustomer || isAwaitingCustomerResponse} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60">
                {isSendingToCustomer ? "Sending..." : isAwaitingCustomerResponse ? "Sent" : "Send Contract to Customer"}
              </button>
            )}
            {isAccepted && <span className={`rounded-lg px-3 py-2 text-sm font-bold ${darkMode ? "border border-emerald-400/30 bg-emerald-500/15 text-emerald-200" : "bg-emerald-50 text-emerald-700"}`}>✓ Contract Accepted &amp; Signed</span>}
            {actionsAllowed && onAccept && <button type="button" onClick={onAccept} disabled={isLoading} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{isLoading ? "Signing..." : "Accept & Sign Contract"}</button>}
            {actionsAllowed && onDecline && <button type="button" onClick={onDecline} disabled={isLoading} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">{isLoading ? "Declining..." : "Decline"}</button>}
            <button type="button" onClick={onClose} aria-label="Close contract" className={closeButtonClass}><X size={22} /></button>
          </div>
        </div>

        {contractStatus === "declined" && inspection.contractDeclineReason && (
          <div className={`border-b px-5 py-3 text-sm ${darkMode ? "border-red-400/30 bg-red-500/10 text-red-200" : "border-red-200 bg-red-50 text-red-800"}`}>
            <span className="font-bold">Contract declined:</span> {inspection.contractDeclineReason}
          </div>
        )}

        <div id="contract-content" className={contentClass}>
          {isAccepted && <img src={approvedStamp} alt="Approved stamp" className="pointer-events-none absolute left-1/2 top-1/2 z-10 w-4/5 -translate-x-1/2 -translate-y-1/2 rotate-[-18deg] opacity-20" />}

          <div className={infoCardClass}>
            <div><span className={infoLabelClass}>Contract No.</span><p className={infoValueClass}>{inspection.contractId || contractData.contractNumber || "N/A"}</p></div>
            <div><span className={infoLabelClass}>Contract Version</span><p className={infoValueClass}>{inspection.contractVersion || contractData.currentContractVersion || 1}</p></div>
            <div><span className={infoLabelClass}>Generated Date</span><p className={infoValueClass}>{inspection.contractGeneratedAt ? formatDate(inspection.contractGeneratedAt) : contractData.contractDate || "N/A"}</p></div>
            <div><span className={infoLabelClass}>Customer</span><p className={infoValueClass}>{customerName}</p></div>
            <div><span className={infoLabelClass}>Order ID</span><p className={`${infoValueClass} break-all`}>{inspection.tracking || inspection._id || inspection.id || contractData.orderNumber || "N/A"}</p></div>
          </div>

          <header className={`grid grid-cols-[1.35fr_1fr_1.35fr] items-start gap-3 border-b-2 ${darkMode ? "border-[#f8b4b4]" : "border-[#5c1118]"} pb-4`}>
            <div className="flex items-center gap-2">
              <img src={logo} alt="ACGC" className="h-12 w-12 object-contain" />
              <div>
                <p className={`font-black ${darkMode ? "text-red-300" : "text-red-700"}`}>ACGC Glass &amp; Aluminum Services</p>
                <p className={`text-[10px] font-bold ${darkMode ? "text-slate-300" : "text-slate-500"}`}>Glass and Aluminum Specialists</p>
              </div>
            </div>
            <h1 className={`text-center text-lg font-black uppercase tracking-wide ${darkMode ? "text-[#8ec5ff]" : "text-[#3f78b5]"}`}>Service Contract</h1>
            <div className={`text-right text-[10px] ${darkMode ? "text-slate-300" : "text-slate-500"}`}>
              <p><span className="font-bold">Contract No:</span> {contractData.orderNumber || "N/A"}</p>
              <p><span className="font-bold">Date:</span> {contractData.contractDate || formatDate(new Date())}</p>
            </div>
          </header>

          <section className={`mt-5 grid grid-cols-2 gap-6 border-b ${darkMode ? "border-slate-600" : "border-slate-200"} pb-4`}>
            <div>
              <h2 className={sectionLabelClass}>Service Provider</h2>
              <p className={`mt-2 font-bold ${darkMode ? "text-red-300" : "text-red-700"}`}> ACGC Glass &amp; Aluminum Services</p>
              <p className={subtleTextDarkClass}>Olongapo City, Zambales</p>
            </div>
            <div>
              <h2 className={sectionLabelClass}>Client</h2>
              <p className={`mt-2 font-bold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{customerName}</p>
              <p className={subtleTextDarkClass}>{customerEmail} | {customerPhone}</p>
              <p className={subtleTextClass}>{siteAddress}</p>
            </div>
          </section>

          <section className="mt-5">
            <h2 className={`${sectionLabelClass} border-b ${darkMode ? "border-slate-600" : "border-slate-200"} pb-2`}>Scope of Work</h2>
            <p className="mt-2 text-[10px]"><span className="font-bold">Site Address:</span> {siteAddress}</p>
            <p className={`mt-1 whitespace-pre-wrap text-[10px] ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{siteNotes}</p>
            <div className={`mt-4 grid grid-cols-2 gap-4 border-b ${darkMode ? "border-slate-600" : "border-slate-200"} pb-3 text-[10px] sm:grid-cols-4`}>
              <p><span className="font-bold">Inspection Date:</span> {inspectionDate}</p>
              <p><span className="font-bold">Est. Install Date:</span> {installationDate}</p>
              <p><span className="font-bold">Client Type:</span> {inspection.order_type === "walk_in_customer" ? "Walk-in" : "Online"}</p>
              <p><span className="font-bold">Warranty:</span> {warrantyPeriodLabel}</p>
            </div>
          </section>

          <section className="mt-4">
            <table className="w-full border-collapse text-[10px]">
              <thead className={`${tableTopClass} text-left uppercase`}>
                <tr>
                  <th className="px-2 py-2">#</th>
                  <th className="px-2 py-2">Product / Description</th>
                  <th className="px-2 py-2 text-center">W x H (Unit)</th>
                  <th className="px-2 py-2 text-center">Qty</th>
                  <th className="px-2 py-2 text-right">Rate</th>
                  {isPerProductWarranty && <th className="px-2 py-2 text-center">Warranty</th>}
                  <th className="px-2 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {contractItems.map((item, index) => {
                  const warranty = getItemWarrantyDetails(item, index);
                  const sourceItem = sourceItems[index] || {};
                  const bladeDetails = getContractBladeDetails(item, sourceItem);
                  return (
                  <tr key={`${item.name || "item"}-${index}`} className={darkMode ? "border-b border-slate-600" : "border-b border-slate-200"}>
                    <td className="px-2 py-2">{index + 1}</td>
                    <td className="px-2 py-2 font-medium">
                      {item.name || "Item"}
                      {bladeDetails.isBlade && (
                        <div className={`mt-1 text-[9px] font-normal ${darkMode ? "text-slate-300" : "text-slate-500"}`}>
                          <div>{bladeDetails.glassName || "Glass"} · {bladeDetails.bladeCount} blades × {formatCurrency(bladeDetails.bladeRate)}/blade</div>
                          {bladeDetails.saleMode === "frame" && (
                            <div>Frame: {bladeDetails.frameName || "Selected frame"}{bladeDetails.framePrice > 0 ? ` · ${formatCurrency(bladeDetails.framePrice)}` : ""}</div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">{item.width || 0} x {item.height || 0} ({item.unit || sourceItem.measurement_unit || "in"})</td>
                    <td className="px-2 py-2 text-center">{item.quantity || 1}</td>
                    <td className="px-2 py-2 text-right">{bladeDetails.isBlade ? <>{formatCurrency(bladeDetails.bladeRate)} / blade{bladeDetails.framePrice > 0 ? <div className="text-[9px]">+ {formatCurrency(bladeDetails.framePrice)} frame</div> : null}</> : formatCurrency(item.unitPrice)}</td>
                    {isPerProductWarranty && (
                      <td className="px-2 py-2 text-center text-[9px]">
                        <div className="font-bold">{warranty.periodText}</div>
                        {warranty.hasCoverage && (
                          <div className={`mt-1 ${darkMode ? "text-slate-300" : "text-slate-500"}`}>
                            <div>Start: {formatDate(warranty.start, "TBD")}</div>
                            <div>End: {formatDate(warranty.expiry, "TBD")}</div>
                          </div>
                        )}
                      </td>
                    )}
                    <td className="px-2 py-2 text-right font-semibold">{formatCurrency(item.amount)}</td>
                  </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className={darkMode ? "bg-[#153451] font-black" : "bg-slate-50 font-black"}>
                  <td colSpan={isPerProductWarranty ? 6 : 5} className="px-2 py-2 text-right uppercase">Total Contract Amount</td>
                  <td className={`px-2 py-2 text-right ${darkMode ? "text-[#9ed0ff]" : "text-[#3f78b5]"}`}>{formatCurrency(totalAmount)}</td>
                </tr>
              </tfoot>
            </table>
          </section>

          <section className={panelClass + " mt-5"}>
            <h2 className={sectionLabelClass}>Payment Terms</h2>
            <p className={`mt-3 text-[10px] ${darkMode ? "text-slate-200" : ""}`}>{paymentTerms}</p>
            <div className="mt-2 grid grid-cols-2 gap-4 text-[10px]">
              <p><span className="font-bold">{paymentReceivedLabel}:</span> {formatCurrency(downPayment)}</p>
              <p><span className="font-bold">{balanceLabel}:</span> {formatCurrency(Math.max(totalAmount - downPayment, 0))}</p>
            </div>
            {agreedPaymentDate && (
              <div className={`mt-3 rounded border px-3 py-2 text-[10px] ${darkMode ? "border-amber-500/40 bg-amber-500/10 text-amber-100" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                <span className="font-bold">Agreed Payment Date (optional):</span> {agreedPaymentDate}
              </div>
            )}
          </section>

          <section className="mt-5">
            <h2 className={`${sectionLabelClass} border-b ${darkMode ? "border-slate-600" : "border-slate-200"} pb-2`}>Warranty</h2>
            <div className={`${minorPanelClass} mt-3`}>
              {isPerProductWarranty ? (
                <>
                  <span className="mr-2">🛡️</span>
                  <span className="font-bold">Product-specific warranty coverage:</span> Warranty periods and start/end dates are listed with each product above. Coverage begins on the listed start date.
                </>
              ) : isNoWarranty ? (
                <>
                  <span className="mr-2">ℹ️</span>
                  <span className="font-bold">No Warranty:</span> This project does not include warranty coverage.
                </>
              ) : (
                <>
                  <span className="mr-2">🛡️</span>
                  <span className="font-bold">{warrantyPeriod}-Day Warranty:</span> ACGC Glass &amp; Aluminum Services provides a {warrantyPeriod}-day warranty on installed products and workmanship starting from the installation date.
                </>
              )}
            </div>
            <div className="mt-3 rounded border border-yellow-300/60 bg-yellow-400/95 px-3 py-2 text-[10px] font-black text-slate-900 shadow-sm">⚠ {isFullPaymentMethod ? "Full payment" : `A downpayment of ${formatCurrency(downPayment)}`} is required to start the project based on the stated policy.</div>
          </section>

          <section className={`mt-6 border-t ${darkMode ? "border-slate-600" : "border-slate-300"} pt-4`}>
            <h2 className={`${sectionLabelClass} border-b ${darkMode ? "border-slate-600" : "border-slate-200"} pb-2`}>Client Acknowledgment</h2>
            {isAccepted ? (
              <div className={`mt-4 flex items-end justify-between gap-6 text-[10px] ${darkMode ? "text-slate-200" : "text-slate-800"}`}>
                <div className="flex-1">
                  <p className="border-b border-slate-500 pb-5 text-center">Electronically Signed by: {contractData.acceptedBy || customerName}</p>
                  <p className={`mt-2 font-semibold ${darkMode ? "text-emerald-300" : "text-emerald-700"}`}>✓ Electronically Signed</p>
                  <p className={darkMode ? "text-slate-300" : "text-slate-600"}>Date: {contractData.acceptanceDate || formatDate(new Date())}</p>
                </div>
                <div className={`w-2/5 rounded p-3 text-[9px] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-50 text-slate-500"}`}>Admin Note: This contract is officially issued by ACGC Glass &amp; Aluminum Services. Signature is implicit upon customer acceptance.</div>
              </div>
            ) : (
              <div className="mt-6 grid grid-cols-2 gap-10 text-[10px]">
                <div><p className="border-b border-slate-500 pb-5 text-center">ACGC Representative</p><p className="mt-2 font-semibold">Prepared by ACGC Glass &amp; Aluminum Services</p></div>
                <div><p className="border-b border-slate-500 pb-5 text-center">Client Signature &amp; Printed Name</p><p className="mt-2 font-semibold">{customerName}</p><p className={darkMode ? "text-slate-300" : "text-slate-500"}>Date: __________________</p></div>
              </div>
            )}
          </section>

          <footer className={footerClass}>
            ACGC GLASS &amp; ALUMINUM SERVICES | This document is based on the customer site inspection details.
          </footer>
        </div>
      </div>
    </div>
  );
}

export default ContractModal;

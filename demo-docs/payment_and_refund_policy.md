# Payment And Refund Policy (Demo)

Fictional payment and refund guidance for medical billing BPO demos.

## Payment Statuses

- pending: submitted but not yet posted
- completed: successfully applied
- failed: declined or rejected
- reversed: previously completed payment later reversed

## Handling Failed Payments

1. Confirm the payment reference and failure status from live records.
2. Do not promise that a failed payment will succeed.
3. Offer to retry guidance or open a payment_issue ticket after confirmation.
4. If the related invoice is overdue, treat the case as high priority.

## Outstanding Balances

Outstanding balance may come from:

- patient responsibility on approved or partially paid claims
- overdue invoices
- pending payments that have not posted

Always verify amounts from invoices and billing accounts before quoting a balance.

## Refund Requests

Refund review may be appropriate when:

- a completed payment exceeds the amount due
- a reversed charge left a credit
- a voided invoice still shows a posted payment

Open a refund_request ticket only after confirming the caller wants formal tracking.

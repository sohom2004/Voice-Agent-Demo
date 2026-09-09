import { DocumentFile } from '../types';

export const SAMPLE_DOCUMENTS: DocumentFile[] = [
  {
    id: 'sample-billing-cs-policy',
    name: 'medical_billing_customer_service_policy.md',
    type: 'markdown',
    size: 2100,
    uploadedAt: Date.now() - 3600000,
    enabled: true,
    summary: 'Demo customer-service standards for medical billing BPO support calls.',
    suggestedQuestions: [
      'When should a support ticket be opened?',
      'What priority should a denied claim receive?',
      'How should agents verify a caller?',
    ],
    content: `# Medical Billing Customer Service Policy (Demo)

This document is a fictional demo policy for training and product demonstrations.

## When To Open A Ticket
Open a support ticket when a claim denial needs investigation, a payment failed, an invoice balance is disputed, or the caller requests written tracking.

## Priority Guidance
- high: denied claims, failed payments tied to due dates
- urgent: escalation cases or unresolved appeals past SLA`
  },
  {
    id: 'sample-claim-denial-policy',
    name: 'claim_denial_and_appeal_policy.md',
    type: 'markdown',
    size: 2400,
    uploadedAt: Date.now() - 7200000,
    enabled: true,
    summary: 'Demo policy covering denied claims, appeal requirements, and escalation triggers.',
    suggestedQuestions: [
      'What is the policy for appealing a denied claim?',
      'When should a denied claim be escalated?',
      'What information is required for an appeal?',
    ],
    content: `# Claim Denial And Appeal Policy (Demo)

## When To Escalate A Denied Claim
Escalate when prior authorization evidence exists but the claim remains denied, the denial affects an overdue balance greater than $250, or the appeal window is within 10 days of expiration.

## Information Required For An Appeal
Collect claim number, service date, provider name, procedure code, denial reason, and supporting authorization references.`
  },
  {
    id: 'sample-insurance-guidelines',
    name: 'insurance_processing_guidelines.md',
    type: 'markdown',
    size: 1800,
    uploadedAt: Date.now() - 10800000,
    enabled: true,
    summary: 'Demo guidelines for explaining claim lifecycle and amounts.',
    suggestedQuestions: [
      'How should claim amounts be explained?',
      'What does partially paid mean?',
    ],
    content: `# Insurance Processing Guidelines (Demo)

When discussing a claim, clearly separate billed amount, allowed amount, insurance paid, customer responsibility, claim status, and denial reason if present.`
  },
  {
    id: 'sample-escalation-policy',
    name: 'billing_escalation_policy.md',
    type: 'markdown',
    size: 1900,
    uploadedAt: Date.now() - 14400000,
    enabled: true,
    summary: 'Demo escalation rules for billing and ticket routing.',
    suggestedQuestions: [
      'When should a billing issue become high priority?',
      'When should a ticket be escalated?',
    ],
    content: `# Billing Escalation Policy (Demo)

Escalate when a ticket remains unresolved after two contacts, an overdue invoice exceeds $400 with failed payments, or a claim appeal is urgent or stalled.`
  },
  {
    id: 'sample-payment-refund-policy',
    name: 'payment_and_refund_policy.md',
    type: 'markdown',
    size: 1700,
    uploadedAt: Date.now() - 18000000,
    enabled: true,
    summary: 'Demo payment failure and refund handling guidance.',
    suggestedQuestions: [
      'How are payment failures handled?',
      'When is a refund review appropriate?',
    ],
    content: `# Payment And Refund Policy (Demo)

Confirm payment reference and failure status from live records. Offer to open a payment_issue ticket after confirmation. Treat failed payments on overdue invoices as high priority.`
  }
];

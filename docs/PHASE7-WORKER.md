# Phase 7 durable campaign worker

`POST /api/campaigns/:id/execute` now validates and persists a `queued` `Job`, then returns **202** with `{ jobId, campaignId, status }`. It never sends provider traffic in the request process.

Run the two processes against the same MySQL database:

```powershell
npm run prisma:migrate       # apply the lease and report-idempotency migrations
npm run build
npm start                    # web API
npm run worker               # dedicated campaign worker (one or more replicas)
```

For local worker development use `npm run worker:dev`. Configure `WORKER_ID` uniquely per replica and tune `CAMPAIGN_WORKER_POLL_MS` (default 2000). Render is configured with a separate `nexaleadai-campaign-worker` worker service; set its `DATABASE_URL` and `ENCRYPTION_KEY` to the same values used by the web service.

## Delivery guarantees

Jobs and individual messages are claimed with conditional `updateMany` writes, a worker ID, random lease token, lease expiry, and heartbeats. Only the owner/token pair can finalise a message or job. Expired message leases become `retry_wait`; expired jobs become queueable. Retryable errors use bounded exponential backoff (three attempts); malformed recipients and missing/invalid integration configuration are permanent failures. Cancellation is cooperative: it is checked between deliveries and persists as `cancelling`/`cancelled`.

A final `CampaignDispatch` row is upserted by `campaign_message_id`, preventing recovery/retry from creating contradictory final campaign reports. Provider adapters remain unchanged: SMTP uses the tenant SMTP integration and WhatsApp uses the unified Cloud/Web gateway; inbox processing remains in the web service.

SMTP and the WhatsApp Web gateway do not expose a transactional idempotency key shared with this database. A crash after provider acceptance but before final database persistence can therefore still require an at-least-once recovery attempt. The leases prevent concurrent duplicate workers and the database records/reports are idempotent, but external delivery cannot be made exactly-once without provider-supported idempotency or an outbox acknowledgement protocol.

# Breaking Changes

## Price Calculation Optionality (March 2026)

- `fetchprices.js` now delegates to the published `elwiz-prices` CLI and only emits raw spot prices plus summaries. Grid/supplier surcharges and hourly cost aggregation moved into ElWiz proper.
- `computePrices` / `calculateCost` flags in `config.yaml` control whether the new price enrichment module is loaded. When both are false (the default), ElWiz subscribes directly to MQTT price topics and forwards spot prices unchanged.
- `PriceService` gained a `manualFeed` mode so other modules (e.g., `PriceCalc`) can inject enriched payloads. Existing subscribers that expect `floatingPrice` / `fixedPrice` must enable these flags.
- Legacy helper `fetch-eu-currencies.js` was removed. Currency conversion is handled internally by the `elwiz-prices` module.

### Action Required

1. If you rely on `floatingPrice`, `fixedPrice`, or cost fields, ensure `computePrices: true` (and `calculateCost: true` if you use hourly cost aggregation) in `config.yaml`.
2. Remove any automation that calls `fetch-eu-currencies.js`; no replacement is necessary.
3. Review downstream consumers to tolerate missing `floatingPrice`/`fixedPrice` when the optional module is disabled.

## Nord Pool API Change (October 2025)

Effective October 1st, 2025, Nord Pool has changed their price interval from 1-hour to 15-minute intervals. This means:

- Nord Pool now provides 96 price points per day (instead of 24)  
- The fetchprices.js program has been updated to handle both intervals
- The default price interval remains 1-hour for backward compatibility

### Action Required

Due to this API change, you should clear your cached price data to avoid inconsistencies:

1. Delete cached price data:
   ```bash
   rm -rf ./data/prices/*
   ```

2. Restart ElWiz:
   ```bash  
   pm2 restart md2run.json
   ```

### Configuration

The new `priceInterval` setting in config.yaml allows you to specify:
- `1h` (default) - 1-hour intervals
- `15m` - 15-minute intervals

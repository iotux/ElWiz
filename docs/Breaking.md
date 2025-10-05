# Breaking Changes

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
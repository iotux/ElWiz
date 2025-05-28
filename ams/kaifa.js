'use strict';

// Defines common DLMS data types and their properties
const dataTypes = {
  'double-long-unsigned': { size: 4, description: 'Unsigned 32-bit integer', tag: 0x06 },
  'long-unsigned': { size: 2, description: 'Unsigned 16-bit integer', tag: 0x12 },
  integer: { size: 1, description: 'Signed 8-bit integer', tag: 0x0f },
  'long-integer': { size: 2, description: 'Signed 16-bit integer', tag: 0x10 },
  'octet-string': { size: 'variable', description: 'Variable length byte string', tag: 0x09 },
  timestamp: { size: 12, description: 'DLMS timestamp (octet-string)', tag: 0x09 },
};

const obisSpecifications = {
  '0.0.1.0.0.255': { description: 'Clock and date', unit: null, scaler: null, dataType: 'octet-string', length: 12, parseAs: 'timestamp' },
  '1.0.1.7.0.255': { description: 'Active power+', unit: 'W', scaler: 0, dataType: 'double-long-unsigned', length: 4 },
  '1.0.2.7.0.255': { description: 'Active power-', unit: 'W', scaler: 0, dataType: 'double-long-unsigned', length: 4 },
  '1.0.3.7.0.255': { description: 'Reactive power+', unit: 'VAr', scaler: 0, dataType: 'double-long-unsigned', length: 4 },
  '1.0.4.7.0.255': { description: 'Reactive power-', unit: 'VAr', scaler: 0, dataType: 'double-long-unsigned', length: 4 },
  '1.0.31.7.0.255': { description: 'IL1 Current', unit: 'A', scaler: -3, dataType: 'double-long-unsigned', length: 4 },
  '1.0.51.7.0.255': { description: 'IL2 Current', unit: 'A', scaler: -3, dataType: 'double-long-unsigned', length: 4 },
  '1.0.71.7.0.255': { description: 'IL3 Current', unit: 'A', scaler: -3, dataType: 'double-long-unsigned', length: 4 },
  '1.0.32.7.0.255': { description: 'ULN1 Phase voltage', unit: 'V', scaler: -1, dataType: 'double-long-unsigned', length: 4 },
  '1.0.52.7.0.255': { description: 'ULN2 Phase voltage', unit: 'V', scaler: -1, dataType: 'double-long-unsigned', length: 4 },
  '1.0.72.7.0.255': { description: 'ULN3 Phase voltage', unit: 'V', scaler: -1, dataType: 'double-long-unsigned', length: 4 },
  '1.1.0.2.129.255': { description: 'OBIS List version identifier', unit: null, scaler: null, dataType: 'octet-string' },
  '0.0.96.1.0.255': { description: 'Meter-ID', unit: null, scaler: null, dataType: 'octet-string' },
  '0.0.96.1.7.255': { description: 'Meter type', unit: null, scaler: null, dataType: 'octet-string' },

  // For List 3 - Total Cumulative Values (elements 15-18 in the array)
  '1.0.1.8.0.255': { description: 'Total Cumulative active import energy A+', unit: 'Wh', scaler: 0, dataType: 'double-long-unsigned', length: 4 },
  '1.0.2.8.0.255': { description: 'Total Cumulative active export energy A-', unit: 'Wh', scaler: 0, dataType: 'double-long-unsigned', length: 4 },
  '1.0.3.8.0.255': { description: 'Total Cumulative hourly reactive import energy R+', unit: 'VArh', scaler: 0, dataType: 'double-long-unsigned', length: 4 },
  '1.0.4.8.0.255': { description: 'Total Cumulative hourly reactive export energy R-', unit: 'VArh', scaler: 0, dataType: 'double-long-unsigned', length: 4 },

  // For List 3 - Hourly/Interval Cumulative Values (elements 4-7 in the array)
  '1.0.1.8.0.255_hourly': { description: 'Cumulative hourly active import energy A+ (interval)', unit: 'Wh', scaler: 0, dataType: 'double-long-unsigned', length: 4 },
  '1.0.2.8.0.255_hourly': { description: 'Cumulative hourly active export energy A- (interval)', unit: 'Wh', scaler: 0, dataType: 'double-long-unsigned', length: 4 },
  '1.0.3.8.0.255_hourly': { description: 'Cumulative hourly reactive import energy R+ (interval)', unit: 'VArh', scaler: 0, dataType: 'double-long-unsigned', length: 4 },
  '1.0.4.8.0.255_hourly': { description: 'Cumulative hourly reactive export energy R- (interval)', unit: 'VArh', scaler: 0, dataType: 'double-long-unsigned', length: 4 },

  // For List 3 - Max Demand Registers (elements 8-11 in the array)
  '1.0.1.6.0.255': { description: 'Active Power+ Max Demand', unit: 'W', scaler: 0, dataType: 'double-long-unsigned', length: 4 },
  '1.0.2.6.0.255': { description: 'Active Power- Max Demand', unit: 'W', scaler: 0, dataType: 'double-long-unsigned', length: 4 },
  '1.0.3.6.0.255': { description: 'Reactive Power+ Max Demand', unit: 'VAr', scaler: 0, dataType: 'double-long-unsigned', length: 4 },
  '1.0.4.6.0.255': { description: 'Reactive Power- Max Demand', unit: 'VAr', scaler: 0, dataType: 'double-long-unsigned', length: 4 },

  // For List 3 - Placeholders & Secondary Timestamp (elements 12, 13, 14 in the array)
  UNKNOWN_LIST3_DLU_1: { description: 'Unknown List3 DLU 1 (Meter Status?)', unit: null, scaler: 0, dataType: 'double-long-unsigned', length: 4 },
  UNKNOWN_LIST3_DLU_2: { description: 'Unknown List3 DLU 2', unit: null, scaler: 0, dataType: 'double-long-unsigned', length: 4 },
  '0.0.1.0.0.255_ts2': { description: 'Clock and date (secondary)', unit: null, scaler: null, dataType: 'octet-string', length: 12, parseAs: 'timestamp' },
  // Note: UNKNOWN_LIST3_DLU_3_T2_A+ etc. are covered by re-using 1.0.1.8.0.255 for totals (elements 15-18)
};

const listConfigurations = {
  list1: {
    skipBytesAtStart: 5,
    hasTimestamp: true,
    elementArrayObisCodes: ['1.0.1.7.0.255'],
  },
  list2: {
    skipBytesAtStart: 5,
    hasTimestamp: true,
    elementArrayObisCodes: [
      '1.1.0.2.129.255',
      '0.0.96.1.0.255',
      '0.0.96.1.7.255',
      '1.0.1.7.0.255',
      '1.0.2.7.0.255',
      '1.0.3.7.0.255',
      '1.0.4.7.0.255',
      '1.0.31.7.0.255',
      '1.0.51.7.0.255',
      '1.0.71.7.0.255',
      '1.0.32.7.0.255',
      '1.0.52.7.0.255',
      '1.0.72.7.0.255',
    ],
  },
  list3: {
    skipBytesAtStart: 5,
    hasTimestamp: true,
    elementArrayObisCodes: [
      '1.1.0.2.129.255', //  1 OBIS List version identifier
      '0.0.96.1.0.255', //  2 Meter ID
      '0.0.96.1.7.255', //  3 Meter type
      '1.0.1.7.0.255', //  4 Active power + (Q1+Q4)
      '1.0.2.7.0.255', //  5 Active power - (Q2+Q3)
      '1.0.3.7.0.255', //  6 Reactive power + (Q1+Q2)
      '1.0.4.7.0.255', //  7 Reactive power - (Q3+Q4)
      '1.0.31.7.0.255', //  8 IL1 Current phase L1
      '1.0.51.7.0.255', //  9 IL2 Current phase L2
      '1.0.71.7.0.255', // 10 IL3 Current phase L3
      '1.0.32.7.0.255', // 11 ULN1 Phase voltage
      '1.0.52.7.0.255', // 12 ULN2 Phase voltage
      '1.0.72.7.0.255', // 13 ULN3 Phase voltage
      '0.0.1.0.0.255', // 14 Clock and date in meter
      '1.0.1.8.0.255', // 15 Cumulative hourly active import energy (A+) (Q1+Q4)
      '1.0.2.8.0.255', // 16 Cumulative hourly active export energy (A-) (Q2+Q3)
      '1.0.3.8.0.255', // 17 Cumulative hourly reactive import energy (R+) (Q1+Q2)
      '1.0.4.8.0.255', // 18 Cumulative hourly reactive export energy (R-) (Q3+Q4)
    ],
  },
};

function parseDoubleLongUnsigned(buffer, offset = 0) {
  return buffer.readUInt32BE(offset);
}
function parseLongUnsigned(buffer, offset = 0) {
  return buffer.readUInt16BE(offset);
}
function parseInteger(buffer, offset = 0) {
  return buffer.readInt8(offset);
}
function parseLongInteger(buffer, offset = 0) {
  return buffer.readInt16BE(offset);
}

function parseTimestamp(buffer, offset = 0) {
  if (buffer.length < offset + 12) {
    throw new Error(`Timestamp parsing error: Buffer too short. Need 12 from offset ${offset}, got ${buffer.length - offset}.`);
  }
  const year = buffer.readUInt16BE(offset);
  if (year === 0xffff) return null;
  const month = buffer.readUInt8(offset + 2);
  const dayOfMonth = buffer.readUInt8(offset + 3);
  const hour = buffer.readUInt8(offset + 5);
  const minute = buffer.readUInt8(offset + 6);
  const second = buffer.readUInt8(offset + 7);
  return new Date(Date.UTC(year, month - 1, dayOfMonth, hour, minute, second));
}

function applyScaler(value, scaler) {
  if (scaler === null || typeof scaler === 'undefined') return value;
  return value * 10 ** scaler;
}

function parseDlmsFrame(hexString) {
  if (typeof hexString !== 'string' || !/^[0-9A-F]*$/.test(hexString)) {
    throw new Error(`Invalid input to parseDlmsFrame: Expected a valid hex string. Received: ${String(hexString).substring(0, 100)}...`);
  }
  const fullFrameBuffer = Buffer.from(hexString, 'hex');

  if (fullFrameBuffer.length < 4) {
    throw new Error(`Invalid HDLC frame: Frame too short. Length: ${fullFrameBuffer.length} bytes.`);
  }

  if (fullFrameBuffer[0] !== 0x7e) {
    throw new Error('Invalid HDLC frame: Missing start delimiter (0x7E).');
  }

  const frameFormatType = fullFrameBuffer[1];
  const pduLengthByte = fullFrameBuffer[2];

  if (frameFormatType !== 0xa0) {
    console.warn(`[ams/kaifa.js parseDlmsFrame] Unexpected frame format byte: 0x${frameFormatType.toString(16)}. Expected 0xA0.`);
  }

  let listType;
  switch (pduLengthByte) {
    case 0x27:
      listType = 'list1';
      break;
    case 0x79:
      listType = 'list2';
      break;
    case 0x9b:
      listType = 'list3';
      break;
    default:
      listType = 'unknown';
      console.warn(`[ams/kaifa.js parseDlmsFrame] Unknown PDU length byte: 0x${pduLengthByte.toString(16)}. List type cannot be determined by this byte alone.`);
  }

  const payloadOffset = 12;
  const fcsLength = 2;
  const endFlagLength = 1;

  const expectedEndFlagIndex = fullFrameBuffer.length - endFlagLength;
  if (fullFrameBuffer[expectedEndFlagIndex] !== 0x7e) {
    throw new Error(`Invalid HDLC frame: Missing or misplaced end delimiter (0x7E). ` + `Expected at index ${expectedEndFlagIndex}, found 0x${fullFrameBuffer[expectedEndFlagIndex].toString(16)}. ` + `Buffer length: ${fullFrameBuffer.length}.`);
  }

  const endOfCosmApduIndex = fullFrameBuffer.length - endFlagLength - fcsLength;

  if (endOfCosmApduIndex < payloadOffset) {
    throw new Error(`Error parsing frame: Calculated end of COSEM APDU (index ${endOfCosmApduIndex}) ` + `is before the payload offset (index ${payloadOffset}). Frame too short or malformed. ` + `Buffer length: ${fullFrameBuffer.length} bytes.`);
  }

  const payloadLength = endOfCosmApduIndex - payloadOffset;

  if (payloadLength < 0) {
    throw new Error(`Error parsing frame: Calculated negative payload length (${payloadLength}). ` + `BufferLen: ${fullFrameBuffer.length}, Offset: ${payloadOffset}, EndOfAPDUIndex: ${endOfCosmApduIndex}.`);
  }

  const payloadBuffer = fullFrameBuffer.slice(payloadOffset, endOfCosmApduIndex);

  if (payloadBuffer.length !== payloadLength) {
    throw new Error(`Internal inconsistency: payloadBuffer length (${payloadBuffer.length}) ` + `does not match calculated payloadLength (${payloadLength}).`);
  }

  const expectedMarkerOffset = payloadOffset - 3;
  if (fullFrameBuffer.length < expectedMarkerOffset + 3 || fullFrameBuffer[expectedMarkerOffset] !== 0xe6 || fullFrameBuffer[expectedMarkerOffset + 1] !== 0xe7 || fullFrameBuffer[expectedMarkerOffset + 2] !== 0x00) {
    console.warn(
      `[ams/kaifa.js parseDlmsFrame] Warning: Expected 'E6E700' marker at offset ${expectedMarkerOffset} but found ` +
        `0x${fullFrameBuffer.slice(expectedMarkerOffset, expectedMarkerOffset + 3).toString('hex')}. ` +
        `PDU Length Byte: 0x${pduLengthByte.toString(16)}.`,
    );
  }

  if (listType === 'unknown') {
    console.warn(`[ams/kaifa.js parseDlmsFrame] List type is 'unknown' based on PDU length byte 0x${pduLengthByte.toString(16)}.`);
  }

  return { listType, payloadBuffer };
}

function decodeObisElement(obisCode, elementBuffer, obisSpec) {
  let parsedValue;
  if (!obisSpec || typeof obisSpec.dataType === 'undefined') {
    throw new Error(`Missing OBIS spec for ${obisCode}.`);
  }
  if (!elementBuffer || elementBuffer.length === undefined) {
    throw new Error(`Invalid elementBuffer for ${obisCode}.`);
  }

  if (obisSpec.parseAs === 'timestamp') {
    parsedValue = parseTimestamp(elementBuffer, 0);
  } else {
    switch (obisSpec.dataType) {
      case 'double-long-unsigned':
        if (elementBuffer.length < 4) throw new Error(`Buffer for ${obisCode} too short for double-long-unsigned. Need 4, got ${elementBuffer.length}`);
        parsedValue = parseDoubleLongUnsigned(elementBuffer, 0);
        break;
      case 'long-unsigned':
        if (elementBuffer.length < 2) throw new Error(`Buffer for ${obisCode} too short for long-unsigned. Need 2, got ${elementBuffer.length}`);
        parsedValue = parseLongUnsigned(elementBuffer, 0);
        break;
      case 'integer':
        if (elementBuffer.length < 1) throw new Error(`Buffer for ${obisCode} too short for integer. Need 1, got ${elementBuffer.length}`);
        parsedValue = parseInteger(elementBuffer, 0);
        break;
      case 'long-integer':
        if (elementBuffer.length < 2) throw new Error(`Buffer for ${obisCode} too short for long-integer. Need 2, got ${elementBuffer.length}`);
        parsedValue = parseLongInteger(elementBuffer, 0);
        break;
      case 'octet-string':
        parsedValue = elementBuffer.toString('ascii');
        break;
      default:
        throw new Error(`Unknown dataType '${obisSpec.dataType}' for ${obisCode}`);
    }
  }

  if (typeof obisSpec.scaler === 'number' && typeof parsedValue === 'number') {
    parsedValue = applyScaler(parsedValue, obisSpec.scaler);
  }

  return { obis: obisCode, description: obisSpec.description, value: parsedValue, unit: obisSpec.unit };
}

function decodeKaifaPayload(inputHexString) {
  if (typeof inputHexString !== 'string') {
    throw new Error(`[ams/kaifa.js] Invalid input to decodeKaifaPayload: Expected a string, got ${typeof inputHexString}.`);
  }

  const debugEnabled = true;

  const hexString = inputHexString.toUpperCase();

  if (!hexString.startsWith('7E')) {
    if (debugEnabled) {
      console.warn(`[ams/kaifa.js DEBUG] Input hexString does not start with 7E. String (start): '${hexString.substring(0, 40)}...'`);
    }
  }

  if (debugEnabled) {
    console.log(`[ams/kaifa.js DEBUG] Kaifa Decoder Input (received hexString) Length: ${hexString.length} chars / ${Math.ceil(hexString.length / 2)} bytes.`);
    console.log(`[ams/kaifa.js DEBUG] Kaifa Decoder Input (received hexString) START: ${hexString.substring(0, Math.min(100, hexString.length))}`);
    console.log(`[ams/kaifa.js DEBUG] Kaifa Decoder Input (received hexString) END: ${hexString.substring(Math.max(0, hexString.length - 100))}`);
  }

  const { listType, payloadBuffer } = parseDlmsFrame(hexString);
  const config = listConfigurations[listType];

  if (!config) {
    throw new Error(`[ams/kaifa.js] Config not found for list type: '${listType}'. PDU Length Byte was 0x${Buffer.from(hexString, 'hex')[2].toString(16)}.`);
  }

  let currentOffset = 0;
  const decodedResult = { listType, headerInfo: null, timestamp: null, elements: {} };

  if (config.skipBytesAtStart > 0) {
    if (payloadBuffer.length < config.skipBytesAtStart) {
      throw new Error(`Payload for list ${listType} too short for header skip. Need ${config.skipBytesAtStart}, got ${payloadBuffer.length}.`);
    }
    decodedResult.headerInfo = payloadBuffer.slice(0, config.skipBytesAtStart).toString('hex');
    currentOffset += config.skipBytesAtStart;
  }

  if (config.hasTimestamp) {
    const tsObisCode = '0.0.1.0.0.255';
    const tsSpec = obisSpecifications[tsObisCode];
    if (!tsSpec) throw new Error(`Timestamp OBIS spec ${tsObisCode} not found.`);

    const tsDataTypeTag = payloadBuffer.readUInt8(currentOffset++);
    if (tsDataTypeTag !== dataTypes['octet-string'].tag) {
      throw new Error(`Expected timestamp tag 0x${dataTypes['octet-string'].tag.toString(16)}, got 0x${tsDataTypeTag.toString(16)} for list ${listType}.`);
    }
    const tsLengthByte = payloadBuffer.readUInt8(currentOffset++);
    if (tsLengthByte !== tsSpec.length) {
      throw new Error(`Expected timestamp data length ${tsSpec.length}, got ${tsLengthByte} for list ${listType}.`);
    }
    if (currentOffset + tsLengthByte > payloadBuffer.length) {
      throw new Error(`Payload too short for timestamp data for list ${listType}.`);
    }
    const timestampBuffer = payloadBuffer.slice(currentOffset, currentOffset + tsLengthByte);
    decodedResult.timestamp = decodeObisElement(tsObisCode, timestampBuffer, tsSpec).value;
    currentOffset += tsLengthByte;
  }

  const arrayTag = payloadBuffer.readUInt8(currentOffset++);
  if (arrayTag !== 0x02) {
    throw new Error(`Expected array tag (0x02), got 0x${arrayTag.toString(16)} for list ${listType}.`);
  }
  const arrayCount = payloadBuffer.readUInt8(currentOffset++);

  for (let i = 0; i < arrayCount; i++) {
    if (i >= config.elementArrayObisCodes.length) {
      if (debugEnabled) {
        console.warn(`[ams/kaifa.js] List ${listType} has ${arrayCount} elements in payload, but only ${config.elementArrayObisCodes.length} are configured. Stopping at element index ${i}.`);
      }
      break;
    }
    const obisCode = config.elementArrayObisCodes[i];
    const spec = obisSpecifications[obisCode];
    if (!spec) throw new Error(`OBIS spec not found for ${obisCode} in list ${listType}.`);

    const expectedElementTag = dataTypes[spec.dataType]?.tag;
    if (!expectedElementTag) throw new Error(`Unknown dataType '${spec.dataType}' for ${obisCode}.`);

    const elementTag = payloadBuffer.readUInt8(currentOffset++);
    if (elementTag !== expectedElementTag) {
      if (!(spec.parseAs === 'timestamp' && elementTag === dataTypes['octet-string'].tag)) {
        throw new Error(`Tag mismatch for ${obisCode} in list ${listType}. Expected 0x${expectedElementTag.toString(16)}, got 0x${elementTag.toString(16)}.`);
      }
    }

    let elementDataLength = 0;
    if (spec.dataType === 'octet-string') {
      elementDataLength = payloadBuffer.readUInt8(currentOffset++);
      if (spec.length && spec.length !== elementDataLength) {
        if (spec.parseAs === 'timestamp' && elementDataLength !== spec.length) {
          throw new Error(`Timestamp ${obisCode} in list ${listType} expected data length ${spec.length}, got ${elementDataLength}.`);
        } else if (spec.parseAs !== 'timestamp') {
          if (debugEnabled) console.warn(`[ams/kaifa.js] OBIS ${obisCode} (octet-string) in list ${listType} has spec.length ${spec.length} but payload length is ${elementDataLength}. Using payload length.`);
        }
      }
    } else {
      elementDataLength = spec.length;
      if (typeof elementDataLength !== 'number' || elementDataLength <= 0) {
        throw new Error(`Invalid length in spec for ${spec.dataType} on ${obisCode} in list ${listType}.`);
      }
    }

    if (currentOffset + elementDataLength > payloadBuffer.length) {
      throw new Error(`Payload too short for ${obisCode} data in list ${listType}. Need ${elementDataLength}, got ${payloadBuffer.length - currentOffset}.`);
    }
    const elementBuffer = payloadBuffer.slice(currentOffset, currentOffset + elementDataLength);
    currentOffset += elementDataLength;

    decodedResult.elements[obisCode] = decodeObisElement(obisCode, elementBuffer, spec);
  }

  if (currentOffset < payloadBuffer.length) {
    if (debugEnabled) {
      console.warn(
        `[ams/kaifa.js] Warning: ${payloadBuffer.length - currentOffset} bytes remaining in payloadBuffer for list ${listType} after parsing all configured elements. Initial arrayCount: ${arrayCount}. Remaining hex: ${payloadBuffer.slice(currentOffset).toString('hex')}`,
      );
    }
  }

  if (debugEnabled) {
    const elementsPreview = Object.keys(decodedResult.elements).map((k) => ({
      obis: k,
      value: decodedResult.elements[k].value instanceof Date ? decodedResult.elements[k].value.toISOString() : decodedResult.elements[k].value,
      unit: decodedResult.elements[k].unit,
    }));
    console.log(`[ams/kaifa.js DEBUG] decodeKaifaPayload successful for list ${listType}. Returning (elements preview):`, JSON.stringify(elementsPreview, null, 2));
  }
  return decodedResult;
}

module.exports = {
  decodeKaifaPayload: decodeKaifaPayload,
  obisSpecifications: obisSpecifications,
  listConfigurations: listConfigurations,
  dataTypes: dataTypes,
  parseDlmsFrame: parseDlmsFrame,
  decodeObisElement: decodeObisElement,
};

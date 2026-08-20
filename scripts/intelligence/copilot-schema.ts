import 'dotenv/config';
import { getAnalyticalSchema } from '../../src/application/customer-intelligence-query/index.js';
import { assertNoPiiInAnalyticalValue } from '../../src/domain/customer-intelligence-query/index.js';
import { serializeAnalyticalSchemaForCopilot } from '../../src/domain/customer-intelligence-copilot/index.js';

const schema = serializeAnalyticalSchemaForCopilot(getAnalyticalSchema());
assertNoPiiInAnalyticalValue(schema, 'copilotSchema');
console.info(JSON.stringify(schema, null, 2));

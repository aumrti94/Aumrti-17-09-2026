import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { schema } from './schema';
import Patient from './models/Patient';
import Appointment from './models/Appointment';
import Vitals from './models/Vitals';
import WardRound from './models/WardRound';

const adapter = new SQLiteAdapter({
  schema,
  dbName: 'aumrti_hms',
  jsi: true,
  onSetUpError: (error) => {
    console.error('WatermelonDB setup error:', error);
  },
});

export const database = new Database({
  adapter,
  modelClasses: [Patient, Appointment, Vitals, WardRound],
});

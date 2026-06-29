import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export default class WardRound extends Model {
  static table = 'ward_rounds';

  @field('remote_id') remoteId!: string;
  @field('hospital_id') hospitalId!: string;
  @field('patient_id') patientId!: string;
  @field('doctor_id') doctorId!: string;
  @field('rounded_at') roundedAt!: number;
  @field('subjective') subjective!: string;
  @field('objective') objective!: string;
  @field('assessment') assessment!: string;
  @field('plan') plan!: string;
  @field('is_synced') isSynced!: boolean;
  @field('synced_at') syncedAt!: number;
}

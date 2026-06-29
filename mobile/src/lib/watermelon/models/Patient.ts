import { Model } from '@nozbe/watermelondb';
import { field, readonly, date } from '@nozbe/watermelondb/decorators';

export default class Patient extends Model {
  static table = 'patients';

  @field('remote_id') remoteId!: string;
  @field('hospital_id') hospitalId!: string;
  @field('uhid') uhid!: string;
  @field('full_name') fullName!: string;
  @field('date_of_birth') dateOfBirth!: string;
  @field('gender') gender!: string;
  @field('phone') phone!: string;
  @field('blood_group') bloodGroup!: string;
  @field('is_synced') isSynced!: boolean;
  @field('synced_at') syncedAt!: number;
}

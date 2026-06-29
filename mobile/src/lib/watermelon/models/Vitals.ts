import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export default class Vitals extends Model {
  static table = 'vitals';

  @field('remote_id') remoteId!: string;
  @field('hospital_id') hospitalId!: string;
  @field('patient_id') patientId!: string;
  @field('recorded_by') recordedBy!: string;
  @field('recorded_at') recordedAt!: number;
  @field('temperature') temperature!: number;
  @field('pulse') pulse!: number;
  @field('bp_systolic') bpSystolic!: number;
  @field('bp_diastolic') bpDiastolic!: number;
  @field('spo2') spo2!: number;
  @field('respiratory_rate') respiratoryRate!: number;
  @field('news2_score') news2Score!: number;
  @field('is_synced') isSynced!: boolean;
  @field('synced_at') syncedAt!: number;
}

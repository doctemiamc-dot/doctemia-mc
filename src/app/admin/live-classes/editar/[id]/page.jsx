'use client';

import { useParams } from 'next/navigation';
import ScheduleForm from '../../ScheduleForm';

export default function EditarClaseEnVivoPage() {
  const { id } = useParams();
  return <ScheduleForm scheduleId={id} />;
}

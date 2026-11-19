import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * Envía una señal Broadcast por Supabase Realtime a los clientes conectados en `/app/clases-en-vivo`
 * para que recarguen al instante cuando el administrador crea, edita, mueve o cancela una clase.
 * @param {string} [action='updated']
 */
export async function broadcastScheduleChange(action = 'updated') {
  try {
    const channel = supabaseAdmin.channel('live-schedules-sync');
    await channel.send({
      type: 'broadcast',
      event: 'schedule-updated',
      payload: { action, timestamp: Date.now() },
    });
    await supabaseAdmin.removeChannel(channel);
  } catch (error) {
    console.warn('No se pudo emitir broadcast de horarios:', error.message);
  }
}

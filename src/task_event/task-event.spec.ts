import { holdLabel, holdNote, reportTimeline, taskEventForStatus, writeTaskEvent } from './task-event';

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 28, 10, minutes));

describe('taskEventForStatus', () => {
  it('maps status changes to timeline steps', () => {
    expect(taskEventForStatus('open', 'in_progress')).toBe('started');
    expect(taskEventForStatus('hold', 'in_progress')).toBe('resumed');
    expect(taskEventForStatus('completed', 'in_progress')).toBe('reopened');
    expect(taskEventForStatus('in_progress', 'hold')).toBe('hold');
    expect(taskEventForStatus('hold', 'completed')).toBe('completed');
    expect(taskEventForStatus('completed', 'closed')).toBe('closed');
    expect(taskEventForStatus('closed', 'open')).toBe('reopened');
  });

  it('ignores unchanged or unknown statuses', () => {
    expect(taskEventForStatus('hold', 'hold')).toBeNull();
    expect(taskEventForStatus('open', undefined)).toBeNull();
    expect(taskEventForStatus('open', 'weird')).toBeNull();
  });
});

describe('hold notes', () => {
  it('labels the hold type like the migration backfill', () => {
    expect(holdLabel('expert_service_required')).toBe('Expert Service Required');
    expect(holdLabel(undefined)).toBe('');
  });

  it('joins type, reason and spare part', () => {
    expect(holdNote({ hold_reason: 'spare_required', reason: ' CAM switch ', spare_part_number: 'SP-1' })).toBe(
      'Spare Required · CAM switch · Spare part SP-1',
    );
    expect(holdNote({ hold_reason: 'others' })).toBe('Others');
    expect(holdNote({ hold_reason: 'spare_required', reason: 'Spare required' })).toBe('Spare Required');
    expect(holdNote(null)).toBeNull();
  });
});

describe('reportTimeline', () => {
  it('keeps only raised, assignment, acceptance, start, completion and closing', () => {
    const rows = reportTimeline([
      { event: 'closed', actor_name: 'Narasimha', created_at: at(50) },
      { event: 'raised', actor_name: 'Ajay', created_at: at(0) },
      { event: 'assigned', actor_name: 'Automatic assignment', target_name: 'Ravi', created_at: at(5) },
      { event: 'reassigned', actor_name: 'Ajay', target_name: 'Surekha', created_at: at(8) },
      { event: 'accepted', actor_name: 'Surekha', created_at: at(10) },
      { event: 'started', actor_name: 'Surekha', created_at: at(12) },
      { event: 'hold', actor_name: 'Surekha', note: 'Spare Required', created_at: at(20) },
      { event: 'resumed', actor_name: 'Surekha', created_at: at(30) },
      { event: 'completed', actor_name: 'Surekha', created_at: at(40) },
    ]);
    expect(rows.map((r) => [r.title, r.detail])).toEqual([
      ['Raised', 'By Ajay'],
      ['Assigned', 'To Surekha by Ajay'],
      ['Accepted', 'By Surekha'],
      ['Work started', 'By Surekha'],
      ['Completed', 'By Surekha'],
      ['Closed', 'By Narasimha'],
    ]);
  });

  it('handles tickets with few or no events', () => {
    expect(reportTimeline(null)).toEqual([]);
    expect(reportTimeline([{ event: 'raised', actor_name: 'Ajay', created_at: at(0) }])).toHaveLength(1);
  });
});

describe('writeTaskEvent', () => {
  it('trims the note and never throws', async () => {
    const create = jest.fn().mockResolvedValue({});
    await writeTaskEvent({ task_event: { create } } as any, { taskId: 4, event: 'hold', note: '  ' });
    expect(create.mock.calls[0][0].data).toMatchObject({ task_link: 4, event: 'hold', actor_name: 'Unknown', note: null });

    const failing = jest.fn().mockRejectedValue(new Error('db down'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(writeTaskEvent({ task_event: { create: failing } } as any, { taskId: 4, event: 'raised' })).resolves.toBeUndefined();
  });
});

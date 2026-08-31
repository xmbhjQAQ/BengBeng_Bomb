import type { GroupParticipant } from './groupTypes';

export function GroupParticipantList({ participants }: { participants: readonly GroupParticipant[] }) {
  if (!participants.length) {
    return <p className="muted group-results-empty">还没有完成记录，等第一位挑战者来报到。</p>;
  }
  return (
    <ol className="group-participant-list" aria-label="参与者完成结果">
      {participants.map((participant, index) => {
        const held = participant.outcome === 'held';
        const key = participant.attemptId ?? `${participant.nickname}-${participant.completedAt ?? index}-${index}`;
        return (
          <li className={`group-participant-row ${held ? 'held' : 'failed'}`} key={key}>
            <span className="group-participant-number" aria-hidden="true">{index + 1}</span>
            <div className="group-participant-name">
              <strong>{participant.nickname}</strong>
              <span>{held ? '全程绷住' : '没绷住'}</span>
            </div>
            <div className="group-participant-time">
              <strong>{participant.elapsedSeconds.toFixed(1)} 秒</strong>
              {participant.outcome === 'failed' && participant.failedAtSeconds !== null && participant.failedAtSeconds !== undefined && (
                <span>爆炸于 {participant.failedAtSeconds.toFixed(1)} 秒</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}


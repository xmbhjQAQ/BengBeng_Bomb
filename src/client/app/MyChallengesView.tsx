import { useEffect, useState } from 'react';
import {
  clearCreatedChallenges,
  readCreatedChallenges,
  removeCreatedChallenge,
  subscribeCreatedChallenges,
  type CreatedChallengeRecord,
} from '../storage/createdChallenges';
import { CopyButton } from './CopyButton';

interface MyChallengesViewProps {
  navigate(path: string): void;
}

const KIND_LABEL: Record<CreatedChallengeRecord['kind'], string> = {
  classic: '单人挑战',
  self: '自己挑战',
  group: '群组挑战',
};

function localPath(value: string): string | null {
  try {
    const url = new URL(value, location.origin);
    return url.origin === location.origin ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

function formatTime(seconds: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(seconds * 1000);
}

function openStoredUrl(value: string, navigate: (path: string) => void) {
  const path = localPath(value);
  if (path) navigate(path);
  else location.assign(value);
}

export function MyChallengesView({ navigate }: MyChallengesViewProps) {
  const [records, setRecords] = useState(() => readCreatedChallenges());

  useEffect(() => subscribeCreatedChallenges(() => setRecords(readCreatedChallenges())), []);

  const remove = (record: CreatedChallengeRecord) => {
    if (!confirm(`从本机记录中移除“${record.video.title}”？`)) return;
    removeCreatedChallenge(record.id);
  };

  const clear = () => {
    if (!confirm('清空当前浏览器保存的全部挑战记录？此操作不会删除线上挑战。')) return;
    clearCreatedChallenges();
  };

  return <div className="my-challenges">
    <div className="my-challenges-heading">
      <div><p className="step">仅保存在当前浏览器</p><h2>我的挑战</h2></div>
      {records.length > 0 && <button type="button" className="secondary" onClick={clear}>清空记录</button>}
    </div>
    <p className="my-challenges-note">这里保存你最近创建的挑战入口，换设备或清除浏览器数据后无法找回。</p>
    {records.length === 0
      ? <div className="my-challenges-empty"><strong>还没有本机记录</strong><p>创建挑战后，私密结果入口会自动保存在这里。</p></div>
      : <ol className="my-challenges-list">{records.map((record) => <li key={record.id} className="my-challenge-card">
        <div className="my-challenge-cover">{record.video.cover ? <img src={record.video.cover} referrerPolicy="no-referrer" alt="" /> : <span>无封面</span>}</div>
        <div className="my-challenge-info">
          <div className="my-challenge-meta"><span>{KIND_LABEL[record.kind]}</span><time dateTime={new Date(record.createdAt * 1000).toISOString()}>{formatTime(record.createdAt)} 创建</time></div>
          <h3>{record.video.title}</h3>
          {record.initiator && <p>发起人：{record.initiator}</p>}
          <p>{record.expiresAt * 1000 > Date.now() ? `可参与至 ${formatTime(record.expiresAt)}` : '挑战参与时间已结束'}</p>
          {record.kind === 'group' && record.resultExpiresAt && <p>结果可查看至 {formatTime(record.resultExpiresAt)}</p>}
        </div>
        <div className="my-challenge-actions">
          {record.kind === 'group' && record.resultUrl && <button type="button" onClick={() => openStoredUrl(record.resultUrl!, navigate)}>查看大家的结果</button>}
          {record.manageUrl && <button type="button" className={record.kind === 'group' ? 'secondary' : ''} onClick={() => openStoredUrl(record.manageUrl, navigate)}>{record.kind === 'group' ? '管理挑战' : '查看状态与结果'}</button>}
          <button type="button" className="secondary" onClick={() => openStoredUrl(record.entryUrl || record.challengeUrl, navigate)}>打开挑战</button>
          <CopyButton value={record.entryUrl || record.challengeUrl} label="复制挑战链接" />
          {record.kind === 'group' && record.resultUrl
            ? <CopyButton value={record.resultUrl} label="复制结果链接" />
            : record.manageUrl && <CopyButton value={record.manageUrl} label="复制私密入口" />}
          <button type="button" className="my-challenge-remove" onClick={() => remove(record)}>移除记录</button>
        </div>
      </li>)}</ol>}
  </div>;
}

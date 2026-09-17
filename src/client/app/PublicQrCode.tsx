import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** A small, public-link-only QR view used by group invitations and results. */
export function PublicQrCode({ url, label, size = 176 }: { url: string; label: string; size?: number }) {
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setError(false);
    void QRCode.toDataURL(url, {
      width: size,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#251b2b', light: '#ffffff' },
    }).then((value) => {
      if (!cancelled) setSource(value);
    }).catch(() => {
      if (!cancelled) setError(true);
    });
    return () => { cancelled = true; };
  }, [size, url]);

  return (
    <figure className="public-qr">
      {source ? <img src={source} alt={`${label}二维码`} width={size} height={size} /> : (
        <div className="public-qr-placeholder" role="img" aria-label={error ? `${label}二维码暂时无法生成` : `${label}二维码生成中`}>
          {error ? '二维码暂时无法生成' : '生成中…'}
        </div>
      )}
      <figcaption>{label}</figcaption>
    </figure>
  );
}

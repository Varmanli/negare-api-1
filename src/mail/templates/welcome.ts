export const welcomeHtml = (displayName?: string) => `
<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;background:#f7f7f8;padding:24px;">
  <div style="max-width:600px;margin:auto;background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.06);padding:28px;">
    <h2 style="margin:0 0 16px;text-align:center;color:#222;">به نگاره خوش آمدید ✨</h2>
    <p style="margin:0 0 12px;color:#333;line-height:2;">
      ${displayName ? `سلام <b>${displayName}</b> عزیز،` : `سلام کاربر عزیز نگاره،`}
      از اینکه به نگاره پیوستید خوشحالیم. حساب شما با موفقیت فعال شد.
    </p>
    <p style="margin:0 0 12px;color:#555;line-height:2;">می‌توانید از بخش ورود با ایمیل/موبایل و رمز تازه وارد شوید.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
    <p style="margin:0;text-align:center;color:#888;">با احترام 🌿 تیم نگاره</p>
  </div>
</div>`;

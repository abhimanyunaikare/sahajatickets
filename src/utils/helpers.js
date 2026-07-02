const QRCode = require('qrcode');
const nodemailer = require('nodemailer');

// ── PRICING ──────────────────────────────────────────────────────
function getAgeCategory(age, tier) {
  if (age <= tier.child_max_age) return 'child';
  if (age <= tier.yuva_max_age) return 'yuva';
  return 'adult';
}

function calculatePrice(age, sex, tier) {
  if (tier.is_free) return 0;
  const category = getAgeCategory(age, tier);
  const sexKey = sex === 'female' ? 'female' : 'male';
  return parseFloat(tier[`${category}_${sexKey}_price`]) || 0;
}

function applyDiscount(baseAmount, discountCode) {
  if (!discountCode) return { discountAmount: 0, finalAmount: baseAmount };
  let discountAmount = 0;
  if (discountCode.type === 'flat') {
    discountAmount = Math.min(discountCode.value, baseAmount);
  } else if (discountCode.type === 'percent') {
    discountAmount = (baseAmount * discountCode.value) / 100;
  } else if (discountCode.type === 'free') {
    discountAmount = baseAmount;
  }
  return {
    discountAmount: Math.round(discountAmount * 100) / 100,
    finalAmount: Math.max(0, Math.round((baseAmount - discountAmount) * 100) / 100)
  };
}

// ── QR CODE ──────────────────────────────────────────────────────
async function generateQRCode(qrUuid) {
  const qrData = JSON.stringify({ uuid: qrUuid, platform: 'sy-events' });
  const qrBase64 = await QRCode.toDataURL(qrData, {
    errorCorrectionLevel: 'H',
    width: 400,
    margin: 2,
    color: { dark: '#1a1a1a', light: '#ffffff' }
  });
  return qrBase64; // base64 data URL
}

async function generateQRBuffer(qrUuid) {
  const qrData = JSON.stringify({ uuid: qrUuid, platform: 'sy-events' });
  return QRCode.toBuffer(qrData, {
    errorCorrectionLevel: 'H',
    width: 400,
    margin: 2
  });
}

// ── EMAIL ─────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT),
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

const langStrings = {
  en: { greeting: 'Jai Shri Mataji!', subject: 'Your Event Ticket', ticketReady: 'Your ticket is ready', showQR: 'Please show this QR code at entry', thankYou: 'Thank you for registering' },
  hi: { greeting: 'जय श्री माताजी!', subject: 'आपका टिकट', ticketReady: 'आपका टिकट तैयार है', showQR: 'प्रवेश पर यह QR कोड दिखाएं', thankYou: 'पंजीकरण के लिए धन्यवाद' },
  mr: { greeting: 'जय श्री माताजी!', subject: 'तुमचे तिकीट', ticketReady: 'तुमचे तिकीट तयार आहे', showQR: 'प्रवेशद्वारावर हा QR कोड दाखवा', thankYou: 'नोंदणीसाठी धन्यवाद' },
};

async function sendTicketEmail(ticket, event, qrBase64) {
  const lang = langStrings[ticket.language] || langStrings.en;
  const qrImageBuffer = Buffer.from(qrBase64.split(',')[1], 'base64');

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #4B0082;">${lang.greeting}</h2>
      <p>${lang.ticketReady}</p>
      <div style="background: #f9f4ff; border-radius: 12px; padding: 20px; margin: 20px 0;">
        <h3 style="margin: 0 0 8px;">${event.title}</h3>
        <p style="margin: 4px 0; color: #555;">📅 ${new Date(event.start_date).toLocaleDateString('en-IN')}${event.end_date !== event.start_date ? ' – ' + new Date(event.end_date).toLocaleDateString('en-IN') : ''}</p>
        <p style="margin: 4px 0; color: #555;">📍 ${event.venue}, ${event.city}</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 16px 0;"/>
        <p style="margin: 4px 0;"><strong>Name:</strong> ${ticket.seeker_name}</p>
        <p style="margin: 4px 0;"><strong>Category:</strong> ${ticket.age_category.charAt(0).toUpperCase() + ticket.age_category.slice(1)} (${ticket.sex})</p>
        <p style="margin: 4px 0;"><strong>Amount Paid:</strong> ${ticket.final_amount === 0 ? 'Free' : '₹' + ticket.final_amount}</p>
      </div>
      <p style="text-align: center; color: #666; font-size: 14px;">${lang.showQR}</p>
      <div style="text-align: center;">
        <img src="cid:qrcode" alt="QR Code" style="width: 200px; height: 200px;"/>
      </div>
      <p style="text-align: center; font-size: 12px; color: #999; margin-top: 24px;">${lang.thankYou}</p>
    </div>
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: ticket.email,
    subject: `${lang.subject} — ${event.title}`,
    html,
    attachments: [{
      filename: 'ticket-qr.png',
      content: qrImageBuffer,
      cid: 'qrcode'
    }]
  });
}

// ── WHATSAPP ──────────────────────────────────────────────────────
// Using Interakt API (popular in India, easy setup)
async function sendWhatsAppTicket(ticket, event, qrBase64) {
  if (!process.env.WHATSAPP_API_KEY || !ticket.phone) return;

  const lang = langStrings[ticket.language] || langStrings.en;
  const message = `${lang.greeting}\n\n*${event.title}*\n📅 ${new Date(event.start_date).toLocaleDateString('en-IN')}\n📍 ${event.venue}\n\n👤 ${ticket.seeker_name}\n\n${lang.showQR}`;

  try {
    await fetch('https://api.interakt.ai/v1/public/message/', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${process.env.WHATSAPP_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        countryCode: '+91',
        phoneNumber: ticket.phone.replace(/\D/g, ''),
        type: 'Template',
        template: {
          name: 'ticket_with_qr',
          languageCode: ticket.language === 'hi' ? 'hi' : 'en',
          bodyValues: [ticket.seeker_name, event.title, new Date(event.start_date).toLocaleDateString('en-IN'), event.venue]
        }
      })
    });
  } catch (err) {
    console.error('WhatsApp send error:', err.message);
    // Non-fatal — email is the backup
  }
}

// Calculate age from date of birth
function calculateAge(dateOfBirth) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

function getAgeCategoryFromDOB(dateOfBirth, tier) {
  const age = calculateAge(dateOfBirth);
  if (!age) return null;
  const childMax = tier?.child_max_age || 12;
  const yuvaMax = tier?.yuva_max_age || 25;
  if (age <= childMax) return 'child';
  if (age <= yuvaMax) return 'yuva';
  return 'adult';
}

module.exports = {
  getAgeCategory,
  calculatePrice,
  applyDiscount,
  generateQRCode,
  generateQRBuffer,
  sendTicketEmail,
  sendWhatsAppTicket,
  calculateAge,
  getAgeCategoryFromDOB
};
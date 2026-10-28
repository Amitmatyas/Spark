// Phone numbers are stored as international digits without "+", e.g. 972501234567,
// which is also the WhatsApp chat id prefix (972501234567@s.whatsapp.net).
const DEFAULT_COUNTRY = process.env.DEFAULT_COUNTRY_CODE || "972";

function normalizePhone(input) {
  let digits = String(input || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = DEFAULT_COUNTRY + digits.slice(1);
  else if (digits.length <= 9) digits = DEFAULT_COUNTRY + digits;
  return digits.length >= 10 && digits.length <= 15 ? digits : "";
}

// 972501234567 -> 050-1234567 for Israeli numbers, +<digits> otherwise.
function displayPhone(digits) {
  if (!digits) return "";
  if (digits.startsWith("972") && digits.length === 12) {
    const local = "0" + digits.slice(3);
    return `${local.slice(0, 3)}-${local.slice(3)}`;
  }
  return "+" + digits;
}

module.exports = { normalizePhone, displayPhone };

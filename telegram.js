export function getTelegramUser() {
  const tg = window.Telegram?.WebApp;

  // Если открыли не из Telegram — дадим тестовый режим
  if (!tg) {
    return {
      id: "web_test_" + (localStorage.getItem("trust_test_id") || "1"),
      username: "web_test",
      first_name: "Web",
      last_name: "Test",
      is_test: true,
    };
  }

  tg.ready();
  const u = tg.initDataUnsafe?.user;
  return {
    id: u?.id ? String(u.id) : "tg_unknown",
    username: u?.username || "",
    first_name: u?.first_name || "",
    last_name: u?.last_name || "",
    is_test: false,
  };
}

export function haptic(type = "light") {
  const tg = window.Telegram?.WebApp;
  try {
    tg?.HapticFeedback?.impactOccurred(type);
  } catch {}
}

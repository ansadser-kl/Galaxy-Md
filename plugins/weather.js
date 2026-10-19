"use strict";
module.exports = {
  name: "weather",
  aliases: [],
  description: "Get current weather for a city",
  category: "Utility",
  async execute({ sock, jid, message, query }) {
    const city = query.trim();
    if (!city) return sock.sendMessage(jid, { text: "Usage: .weather <city>\nExample: .weather Kochi" }, { quoted: message });
    const geoRes = await fetch("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(city) + "&count=1&language=en&format=json");
    const geo = await geoRes.json();
    const place = geo.results?.[0];
    if (!place) return sock.sendMessage(jid, { text: "City not found. Try another city name." }, { quoted: message });
    const wxRes = await fetch("https://api.open-meteo.com/v1/forecast?latitude=" + place.latitude + "&longitude=" + place.longitude + "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m");
    const wx = await wxRes.json();
    const c = wx.current;
    const labels = {0:"Clear sky",1:"Mainly clear",2:"Partly cloudy",3:"Overcast",45:"Fog",48:"Rime fog",51:"Light drizzle",53:"Drizzle",55:"Heavy drizzle",61:"Light rain",63:"Rain",65:"Heavy rain",71:"Light snow",73:"Snow",75:"Heavy snow",80:"Rain showers",81:"Rain showers",82:"Heavy rain showers",95:"Thunderstorm",96:"Thunderstorm with hail",99:"Thunderstorm with hail"};
    const text = "🌦️ *Weather — " + place.name + (place.country ? ", " + place.country : "") + "*\n" +
      "🌡️ Temperature: " + c.temperature_2m + "°C\nFeels like: " + c.apparent_temperature + "°C\n" +
      "☁️ " + (labels[c.weather_code] || "Current conditions") + "\n💧 Humidity: " + c.relative_humidity_2m + "%\n💨 Wind: " + c.wind_speed_10m + " km/h";
    await sock.sendMessage(jid, { text }, { quoted: message });
  }
};

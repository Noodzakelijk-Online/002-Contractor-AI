const DEFAULT_GEOCODING_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';
const DEFAULT_FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const { BoundedJsonResponseError, readBoundedJsonResponse } = require('./bounded-json');

class WeatherProviderError extends Error {
  constructor(message, { code = 'weather_provider_unavailable', statusCode = 503, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'WeatherProviderError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function weatherCondition(code, precipitationPercent, windGustKph) {
  if (code >= 95) return 'storm_risk';
  if (windGustKph >= 55) return 'wind_risk';
  if (code >= 51 || precipitationPercent >= 60) return 'rain_risk';
  if (code === 45 || code === 48) return 'visibility_risk';
  if (code === 3) return 'overcast';
  if (code === 2) return 'partly_cloudy';
  return 'workable';
}

function weatherDescription(code) {
  const descriptions = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Heavy drizzle',
    56: 'Freezing drizzle',
    57: 'Heavy freezing drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    66: 'Freezing rain',
    67: 'Heavy freezing rain',
    71: 'Slight snow',
    73: 'Moderate snow',
    75: 'Heavy snow',
    77: 'Snow grains',
    80: 'Rain showers',
    81: 'Moderate rain showers',
    82: 'Heavy rain showers',
    85: 'Snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with hail',
    99: 'Severe thunderstorm with hail'
  };
  return descriptions[code] || 'Forecast unavailable';
}

function safeText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

class OpenMeteoWeatherService {
  constructor(options = {}) {
    this.fetch = options.fetch || global.fetch;
    this.enabled = options.enabled !== false;
    this.geocodingEndpoint = options.geocodingEndpoint || process.env.WEATHER_GEOCODING_ENDPOINT || DEFAULT_GEOCODING_ENDPOINT;
    this.forecastEndpoint = options.forecastEndpoint || process.env.WEATHER_FORECAST_ENDPOINT || DEFAULT_FORECAST_ENDPOINT;
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs || process.env.WEATHER_PROVIDER_TIMEOUT_MS || 8000));
    this.maxResponseBytes = Math.max(1024, Number(options.maxResponseBytes || process.env.WEATHER_PROVIDER_MAX_RESPONSE_BYTES || DEFAULT_MAX_RESPONSE_BYTES));
  }

  async fetchJson(url) {
    if (!this.enabled) {
      throw new WeatherProviderError('Live weather provider is disabled. Record a manual assessment instead.', { code: 'weather_provider_disabled' });
    }
    if (typeof this.fetch !== 'function') {
      throw new WeatherProviderError('Live weather provider is unavailable because fetch is not configured.');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response?.ok) {
        throw new WeatherProviderError(`Live weather provider returned ${response?.status || 'an invalid response'}.`, { code: 'weather_provider_failed' });
      }
      try {
        return await readBoundedJsonResponse(response, { maxBytes: this.maxResponseBytes });
      } catch (error) {
        if (error instanceof BoundedJsonResponseError) {
          const code = {
            json_response_content_type_invalid: 'weather_provider_invalid_content_type',
            json_response_invalid: 'weather_provider_invalid_response',
            json_response_too_large: 'weather_provider_response_too_large'
          }[error.code] || 'weather_provider_response_invalid';
          throw new WeatherProviderError('Live weather provider returned an invalid bounded JSON response.', { code, statusCode: 502, cause: error });
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof WeatherProviderError) throw error;
      throw new WeatherProviderError('Live weather provider could not be reached. No weather assessment was recorded.', {
        code: error?.name === 'AbortError' ? 'weather_provider_timeout' : 'weather_provider_unavailable',
        cause: error
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async resolveLocation(input = {}) {
    const latitude = numberOrNull(input.latitude ?? input.lat);
    const longitude = numberOrNull(input.longitude ?? input.lng ?? input.lon);
    if (latitude !== null && longitude !== null) {
      return { latitude, longitude, label: safeText(input.location, `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`) };
    }

    const query = safeText(input.location || input.address || input.city || input.region);
    if (!query) {
      throw new WeatherProviderError('A job address, city, or coordinates are required for a live weather assessment.', {
        code: 'weather_location_missing',
        statusCode: 400
      });
    }
    const url = new URL(this.geocodingEndpoint);
    url.search = new URLSearchParams({ name: query, count: '1', language: 'en', format: 'json' }).toString();
    const payload = await this.fetchJson(url);
    const result = Array.isArray(payload?.results) ? payload.results[0] : null;
    if (!result || numberOrNull(result.latitude) === null || numberOrNull(result.longitude) === null) {
      throw new WeatherProviderError(`No live-weather location was found for "${query}".`, { code: 'weather_location_not_found', statusCode: 404 });
    }
    const parts = [result.name, result.admin1, result.country].filter(Boolean);
    return {
      latitude: Number(result.latitude),
      longitude: Number(result.longitude),
      label: parts.join(', ') || query
    };
  }

  selectForecast(hourly = {}, forecastAt) {
    const times = Array.isArray(hourly.time) ? hourly.time : [];
    if (!times.length) {
      throw new WeatherProviderError('Live weather provider did not return an hourly forecast.', { code: 'weather_provider_invalid_response' });
    }
    const targetMs = Number.isFinite(Date.parse(forecastAt)) ? Date.parse(forecastAt) : Date.now();
    let index = 0;
    let distance = Number.POSITIVE_INFINITY;
    for (let current = 0; current < times.length; current += 1) {
      const timestamp = Date.parse(`${times[current]}Z`);
      const candidateDistance = Math.abs((Number.isFinite(timestamp) ? timestamp : targetMs) - targetMs);
      if (candidateDistance < distance) {
        index = current;
        distance = candidateDistance;
      }
    }
    const at = key => Array.isArray(hourly[key]) ? hourly[key][index] : null;
    return {
      forecastAt: times[index] ? `${times[index]}Z` : new Date(targetMs).toISOString(),
      temperatureC: numberOrNull(at('temperature_2m')),
      precipitationPercent: Math.max(0, Math.min(100, numberOrNull(at('precipitation_probability')) ?? 0)),
      weatherCode: numberOrNull(at('weather_code')) ?? 0,
      windKph: Math.max(0, numberOrNull(at('wind_speed_10m')) ?? 0),
      windGustKph: Math.max(0, numberOrNull(at('wind_gusts_10m')) ?? 0)
    };
  }

  async assess(input = {}) {
    const location = await this.resolveLocation(input);
    const url = new URL(this.forecastEndpoint);
    url.search = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      hourly: 'temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m',
      forecast_days: '16'
    }).toString();
    const payload = await this.fetchJson(url);
    const forecast = this.selectForecast(payload?.hourly, input.forecastAt || input.forecast_at);
    const condition = weatherCondition(forecast.weatherCode, forecast.precipitationPercent, forecast.windGustKph);
    const risk = ['rain_risk', 'wind_risk', 'storm_risk', 'visibility_risk'].includes(condition);
    const recommendation = risk
      ? `Forecast risk: ${weatherDescription(forecast.weatherCode)} with ${forecast.precipitationPercent}% precipitation probability and gusts up to ${forecast.windGustKph} km/h. Draft a schedule change or indoor fallback for approval.`
      : `Forecast is workable: ${weatherDescription(forecast.weatherCode)}, ${forecast.temperatureC ?? 'unknown'} C, ${forecast.precipitationPercent}% precipitation probability, gusts up to ${forecast.windGustKph} km/h. Recheck before dispatch.`;
    return {
      location: location.label,
      latitude: location.latitude,
      longitude: location.longitude,
      forecastAt: forecast.forecastAt,
      condition,
      recommendation,
      precipitationPercent: forecast.precipitationPercent,
      temperatureC: forecast.temperatureC,
      windKph: forecast.windKph,
      windGustKph: forecast.windGustKph,
      weatherCode: forecast.weatherCode,
      weatherDescription: weatherDescription(forecast.weatherCode),
      source: 'open_meteo',
      fetchedAt: new Date().toISOString(),
      provider: {
        name: 'Open-Meteo',
        rawUnits: payload?.hourly_units || {}
      }
    };
  }
}

module.exports = {
  DEFAULT_FORECAST_ENDPOINT,
  DEFAULT_GEOCODING_ENDPOINT,
  DEFAULT_MAX_RESPONSE_BYTES,
  OpenMeteoWeatherService,
  WeatherProviderError,
  weatherCondition,
  weatherDescription
};

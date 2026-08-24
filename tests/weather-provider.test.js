const test = require('node:test');
const assert = require('node:assert/strict');
const { OpenMeteoWeatherService, WeatherProviderError } = require('../weather-service');

test('Open-Meteo weather service geocodes a job location and turns a risky forecast into an auditable assessment', async () => {
  const requests = [];
  const service = new OpenMeteoWeatherService({
    geocodingEndpoint: 'https://weather.test/geocode',
    forecastEndpoint: 'https://weather.test/forecast',
    fetch: async url => {
      const parsed = new URL(url);
      requests.push(parsed);
      if (parsed.pathname === '/geocode') {
        const body = { results: [{ name: 'Utrecht', admin1: 'Utrecht', country: 'Netherlands', latitude: 52.09, longitude: 5.12 }] };
        return {
          ok: true,
          headers: { get: () => 'application/json; charset=utf-8' },
          body: new ReadableStream({ start(controller) { controller.enqueue(Buffer.from(JSON.stringify(body))); controller.close(); } })
        };
      }
      const body = {
        hourly_units: { temperature_2m: 'degC', precipitation_probability: '%', wind_gusts_10m: 'km/h' },
        hourly: {
          time: ['2026-07-11T08:00', '2026-07-11T09:00'],
          temperature_2m: [18, 17],
          precipitation_probability: [20, 78],
          weather_code: [2, 63],
          wind_speed_10m: [16, 24],
          wind_gusts_10m: [25, 58]
        }
      };
      return {
        ok: true,
        headers: { get: () => 'application/json; charset=utf-8' },
        body: new ReadableStream({ start(controller) { controller.enqueue(Buffer.from(JSON.stringify(body))); controller.close(); } })
      };
    }
  });

  const assessment = await service.assess({ location: 'Utrecht', forecastAt: '2026-07-11T09:00:00.000Z' });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].searchParams.get('name'), 'Utrecht');
  assert.equal(requests[1].searchParams.get('latitude'), '52.09');
  assert.equal(assessment.source, 'open_meteo');
  assert.equal(assessment.location, 'Utrecht, Utrecht, Netherlands');
  assert.equal(assessment.condition, 'wind_risk');
  assert.equal(assessment.precipitationPercent, 78);
  assert.equal(assessment.windGustKph, 58);
  assert.equal(assessment.weatherDescription, 'Moderate rain');
  assert.match(assessment.recommendation, /Draft a schedule change/i);
});

test('live weather explicitly fails rather than inventing a forecast when the provider is disabled', async () => {
  const service = new OpenMeteoWeatherService({ enabled: false });
  await assert.rejects(
    service.assess({ location: 'Amsterdam' }),
    error => error instanceof WeatherProviderError && error.code === 'weather_provider_disabled'
  );
});

test('weather provider rejects an oversized streamed response before forecast parsing', async () => {
  const service = new OpenMeteoWeatherService({
    maxResponseBytes: 1024,
    fetch: async () => ({
      ok: true,
      headers: { get: name => name.toLowerCase() === 'content-type' ? 'application/json' : null },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from(`{"hourly":"${'x'.repeat(2_000)}"}`));
          controller.close();
        }
      })
    })
  });
  await assert.rejects(
    service.assess({ latitude: 52.09, longitude: 5.12, location: 'Utrecht' }),
    error => error instanceof WeatherProviderError && error.code === 'weather_provider_response_too_large'
  );
});

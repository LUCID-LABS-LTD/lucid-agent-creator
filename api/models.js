import { PublicError, fail, method, request, send } from '../lib/openrouter.js';

function clean(data, predicate = () => true) {
  if (!Array.isArray(data?.data)) throw new PublicError('OpenRouter returned an invalid model catalog. Please retry.', 502);
  return data.data.filter(item => typeof item?.id === 'string' && predicate(item)).map(item => ({ id: item.id, name: typeof item.name === 'string' ? item.name : item.id }));
}

export default async function handler(req, res) {
  if (!method(req, res, 'GET')) return;
  try {
    const [text, image] = await Promise.all([
      request('/models?output_modalities=text', {}, 15_000),
      request('/images/models', {}, 15_000)
    ]);
    return send(res, 200, {
      text: clean(text, item => !item.architecture?.input_modalities || item.architecture.input_modalities.includes('text')),
      // Exclude edit-only and vector-only models; this workflow requests a raster from text.
      image: clean(image, item => !(item.supported_parameters?.input_references?.min > 0) &&
        !(Array.isArray(item.supported_parameters?.output_format?.values) &&
          item.supported_parameters.output_format.values.every(format => format === 'svg')))
    });
  } catch (error) { return fail(res, error); }
}

/** Explicit MOCK category meanings. These values are not inferred from labels
 * and are not a production layout/permission authority. */
export function fixtureCompositionPolicy(now, locked_fields = []) {
  return { contract: 'CreativeCompositionControlPolicy', schema_version: '1.0', policy_id: 'fixture:composition-controls', policy_version: 'fixture-v1',
    targets: { name_layer_id: 'layer:name', layout_layer_id: 'layer:name', logo_layer_id: 'layer:logo', logo_asset_id: 'asset-1' },
    name_sizes: { small: { value: '18', unit: 'pt' }, medium: { value: '24', unit: 'pt' }, large: { value: '36', unit: 'pt' } },
    layouts: { centered: { x_milli: 100, y_milli: 400, width_milli: 800, height_milli: 100 },
      stacked_balanced: { x_milli: 200, y_milli: 550, width_milli: 600, height_milli: 120 }, stacked_name: { x_milli: 100, y_milli: 550, width_milli: 800, height_milli: 180 } },
    logos: { top: { x_milli: 800, y_milli: 50, width_milli: 150, height_milli: 150 }, bottom: { x_milli: 800, y_milli: 800, width_milli: 150, height_milli: 150 } },
    locked_fields, allow_text: true, text_limit: 120, size_bounds: { min_value: '1', max_value: '120', units: ['pt', 'px'] }, checked_at: now - 1000, expires_at: now + 60000 };
}

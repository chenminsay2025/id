/** key -> { id, n: 行数 } — 血统证书默认表格列与 SVG field-* 对应关系 */
export const FIELD_MAP = {
  介绍: { id: 'field-intro', n: 6 },
  编号: { id: 'field-regno', n: 1 },
  所有人: { id: 'field-owner', n: 1 },
  繁育人: { id: 'field-breeder', n: 1 },
  猫舍: { id: 'field-cattery', n: 1 },
  父名: { id: 'field-sire', n: 3 },
  父AB: { id: 'field-fAB', n: 4 },
  父A: { id: 'field-fA', n: 4 },
  父B: { id: 'field-fB', n: 4 },
  '父A-1': { id: 'field-fA1', n: 3 },
  '父A-2': { id: 'field-fA2', n: 3 },
  '父B-1': { id: 'field-fB1', n: 3 },
  '父B-2': { id: 'field-fB2', n: 3 },
  父CD: { id: 'field-fCD', n: 4 },
  父C: { id: 'field-fC', n: 4 },
  父D: { id: 'field-fD', n: 4 },
  '父C-1': { id: 'field-fC1', n: 3 },
  '父C-2': { id: 'field-fC2', n: 3 },
  '父D-1': { id: 'field-fD1', n: 3 },
  '父D-2': { id: 'field-fD2', n: 3 },
  母名: { id: 'field-dam', n: 3 },
  母AB: { id: 'field-mAB', n: 4 },
  母A: { id: 'field-mA', n: 4 },
  母B: { id: 'field-mB', n: 4 },
  '母A-1': { id: 'field-mA1', n: 3 },
  '母A-2': { id: 'field-mA2', n: 3 },
  '母B-1': { id: 'field-mB1', n: 3 },
  '母B-2': { id: 'field-mB2', n: 3 },
  母CD: { id: 'field-mCD', n: 4 },
  母C: { id: 'field-mC', n: 4 },
  母D: { id: 'field-mD', n: 4 },
  '母C-1': { id: 'field-mC1', n: 3 },
  '母C-2': { id: 'field-mC2', n: 3 },
  '母D-1': { id: 'field-mD1', n: 3 },
  '母D-2': { id: 'field-mD2', n: 3 },
}

export const COLUMN_TO_FIELD = Object.fromEntries(
  Object.entries(FIELD_MAP).map(([k, v]) => [k, v.id]),
)

export const FIELD_ID_TO_COLUMN = Object.fromEntries(
  Object.entries(FIELD_MAP).map(([col, spec]) => [spec.id, col]),
)

export const COLUMNS = Object.keys(FIELD_MAP)

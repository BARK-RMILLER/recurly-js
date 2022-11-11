import { ApplePay } from './apple-pay';

/**
 * Instantiation factory
 *
 * @param  {Object} options
 * @return {ApplePay}
 */
export function factory (options) {
  return new ApplePay(Object.assign({}, options, { recurly: this }));
}

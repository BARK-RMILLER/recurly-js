import Emitter from 'component-emitter';

export { ApplePayStrategyApi4 } from './api-4';
export { ApplePayStrategyApi10 } from './api-10';
export { ApplePayStrategyApi14 } from './api-14';
export { ApplePayStrategyBraintree } from './braintree';

export class ApplePayStrategy extends Emitter {
  static strategyFor ({ braintree: { clientAuthorization } = {} } = {}) {
    if (clientAuthorization) {
      return ApplePayStrategyBraintree;
    }

    return [
      ApplePayStrategyApi14,
      ApplePayStrategyApi10,
      ApplePayStrategyApi4
    ].find(strategy => window.ApplePaySession.supportsVersion(strategy.APPLE_PAY_API_VERSION))
  }

  static I18N = {
    subtotalLineItemLabel: 'Subtotal',
    discountLineItemLabel: 'Discount',
    taxLineItemLabel: 'Tax',
    giftCardLineItemLabel: 'Gift card'
  };

  constructor (options) {
    this.configure(options);
  }

  /**
   * Configures a new instance
   *
   * @param  {Object} options
   * @private
   */
  configure (options) {
    const { label, recurly } = options;

    if (!('label' in options)) {
      return this.initError = this.error('apple-pay-config-missing', { opt: 'label' });
    }

    if (!('recurly' in options)) {
      return this.initError = this.error('apple-pay-factory-only');
    }

    this.recurly = recurly;
    const config = {
      label,
      lineItems: [],
      requiredShippingContactFields,
      form,
      i18n: {
        ...this.constructor.I18N,
        ...this.config.i18n,
        ...options.i18n
      }
    };

    if (options.pricing instanceof PricingPromise) {
      this.config.pricing = options.pricing.pricing;
    } else if (options.pricing instanceof Pricing) {
      this.config.pricing = options.pricing;
    } else if ('total' in options) {
      this.config.total = options.total;
    } else {
      return this.initError = this.error('apple-pay-config-missing', { opt: 'total' });
    }

    // If pricing is provided, attach change listeners
    if (this.config.pricing) {
      this.config.pricing.on('change', () => this.onPricingChange());
      if (this.config.pricing.hasPrice) this.onPricingChange();
    }

    this.config = {
      ...config,
      ...this.configureFromRemote(options)
    };
  }

  /**
   * Assigns configuration from remote settings
   *
   * @param  {String} options.country
   * @param  {String} options.currency
   * @private
   */
  configurationFromRemote ({
    country,
    currency
  }) {
    this.recurly.request.get({
      route: '/apple_pay/info',
      data: { currency },
      done: (err, info) => {
        if (err) return this.initError = this.error(err);
        const { countries, currencies, merchantCapabilities, supportedNetworks } = info;

        if ('countries' in info && ~countries.indexOf(country)) {
          this.config.country = country;
        } else {
          return this.initError = this.error('apple-pay-config-invalid', { opt: 'country', set: countries });
        }

        if ('currencies' in info && ~currencies.indexOf(currency)) {
          this.config.currency = currency;
        } else {
          return this.initError = this.error('apple-pay-config-invalid', { opt: 'currency', set: currencies });
        }

        this.config.merchantCapabilities = merchantCapabilities || [];
        this.config.supportedNetworks = supportedNetworks || [];

        this.emit('ready');
      }
    });
  }
}
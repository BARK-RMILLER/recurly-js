import Emitter from 'component-emitter';
import Promise from 'promise';
import recurlyError from '../errors';
import { loadScript, loadStyle } from '../../util/dom';
import AdyenGateway from './gateways/adyen';

const GATEWAYS = {
  adyen: AdyenGateway,
};

class AlternativePaymentMethods extends Emitter {
  constructor (recurly, options) {
    super();
    this.recurly = recurly;
    this.options = options;

    this.gatewayStrategy = undefined;
  }

  async start () {
    try {
      await this.validateOptions();
      const { gatewayType, paymentMethodData } = await this.getPaymentMethods();
      this.gatewayType = gatewayType;
      this.gatewayStrategy = await this.selectGatewayStrategy(gatewayType);

      await this.setupGatewayStrategyListeners();
      await this.loadExternalLibraries();
      await this.initWebComponent(paymentMethodData);
    } catch(err) {
      this.error(err);
    }
  }

  async submit () {
    try {
      const token = await this.tokenizePaymentMethod();
      this.emit('token', token);
    } catch (err) {
      this.error(err);
    }
  }

  async handleAction (paymentResponse) {
    try {
      this.gatewayStrategy.handleAction(paymentResponse);
    } catch (err) {
      this.error(err);
    }
  }

  // private

  error (err) {
    return this.emit('error', err);
  }

  get allowedGatewayTypes () {
    return Object.keys(GATEWAYS).filter(type => type in this.options);
  }

  async validateOptions () {
    const getMissingField = (options, fields) => {
      for(const field of fields) {
        if (!(field in options)) {
          return field;
        }
      }

      return undefined;
    };

    const missingField = getMissingField(this.options, [
      'allowedPaymentMethods',
      'currency',
      'amount',
      'countryCode',
      'containerSelector',
    ]);
    if (missingField) {
      throw recurlyError('payment-methods-config-missing', { opt: missingField });
    }

    this.allowedGatewayTypes.forEach(gatewayType => {
      const gatewayMissingField = getMissingField(this.options[gatewayType], [
        'publicKey',
      ]);

      if (gatewayMissingField) {
        throw recurlyError('payment-methods-config-missing', { opt: `${gatewayType}.${gatewayMissingField}` });
      }
    });

    if (!this.allowedGatewayTypes.length) {
      throw recurlyError('payment-methods-config-missing', { opt: Object.keys(GATEWAYS).join(', ') });
    }
  }

  async getPaymentMethods () {
    return this.recurly.request.get({
      route: '/payment_methods/list',
      data: {
        allowedPaymentMethods: this.options.allowedPaymentMethods,
        blockedPaymentMethods: this.options.blockedPaymentMethods,
        currency: this.options.currency,
        amount: this.options.amount,
        countryCode: this.options.countryCode,
        locale: this.options.locale || 'en-US',
        channel: this.options.channel || 'Web',
        allowedGatewayTypes: this.allowedGatewayTypes,
      },
    });
  }

  async selectGatewayStrategy (gatewayType) {
    const gatewayClass = GATEWAYS[gatewayType];

    if (!gatewayClass) {
      throw recurlyError('payment-methods-not-available');
    }

    return new gatewayClass(this.options);
  }

  async setupGatewayStrategyListeners () {
    this.gatewayStrategy.on('change', valid => {
      this.emit('valid', valid);
    });

    this.gatewayStrategy.on('submit', () => {
      this.submit();
    });

    this.gatewayStrategy.on('error', err => {
      this.error(err);
    });
  }

  async loadExternalLibraries () {
    if (this.gatewayStrategy.libsLoaded()) {
      return;
    }

    return Promise.all([
      ...this.gatewayStrategy.scripts().map(({ url, ...attrs }) => loadScript(url, attrs)),
      ...this.gatewayStrategy.styles().map(({ url, ...attrs }) => loadStyle(url, attrs)),
    ]);
  }

  async initWebComponent (paymentMethodData) {
    return this.gatewayStrategy.createAndMountWebComponent(paymentMethodData);
  }

  async tokenizePaymentMethod () {
    return this.recurly.request.post({
      route: '/payment_methods/token',
      data: {
        currency: this.options.currency,
        amount: this.options.amount,
        countryCode: this.options.countryCode,
        locale: this.options.locale || 'en-US',
        channel: this.options.channel || 'Web',
        paymentMethodData: this.gatewayStrategy.data,
        gatewayType: this.gatewayType,
      },
    });
  }
}

export default AlternativePaymentMethods;

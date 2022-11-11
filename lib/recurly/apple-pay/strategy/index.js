import Emitter from 'component-emitter';
import { ApplePayStrategyBraintree } from './braintree';
import { ApplePayStrategyApi4 } from './api-4';
import { ApplePayStrategyApi10 } from './api-10';
import { ApplePayStrategyApi14 } from './api-14';

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

  constructor () {

  }
}
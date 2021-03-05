import loadScript from 'load-script';
import Promise from 'promise';
import ThreeDSecureStrategy from './strategy';
import { Frame } from '../../../frame';

const debug = require('debug')('recurly:strategy:adyen');

export default class AdyenStrategy extends KakaoPayStrategy {
  static libUrl = 'https://checkoutshopper-test.adyen.com/checkoutshopper/sdk/3.15.1/adyen.js'
  static strategyName = 'adyen';

  constructor (...args) {
    super(...args);

    if (!this.shouldLoadAdyenLibrary) return;
    debug('loading Adyen library');
    this.loadAdyenLibrary()
      .catch(cause => this.error('load-error', { vendor: 'Adyen', cause }))
      .then(() => {
        this.adyenCheckout = new window.AdyenCheckout();
        debug('Adyen checkout instance created', this.adyenCheckout);
        this.markReady();
      });
  }

  get shouldLoadAdyenLibrary () {
    return !this.shouldFallback;
  }

  get shouldChallenge () {
    return !!this.adyenChallengeToken;
  }

  get shouldFallback () {
    return !!this.adyenRedirectParams;
  }

  get adyenChallengeToken () {
    const { authentication } = this.actionToken.params;
    return authentication && authentication['challengeToken'];
  }

  get adyenRedirectParams () {
    return this.actionToken.params.redirect;
  }

  /**
   * Provides the target DOM element for which we will apply
   * fingerprint detection, challenge flows, and results
   *
   * @param {HTMLElement} element
   */
  attach (element) {
    super.attach(element);

    const { shouldFallback, shouldChallenge } = this;

    if (shouldChallenge) {
      this.whenReady(() => this.challenge());
    } else if (shouldFallback) {
      this.fallback();
    } else {
      const cause = 'We could not determine an authentication method';
      this.actionToken.error('auth error', { cause });
    }
  }

  /**
   * Removes DOM elements
   */
  remove () {
    const { frame } = this;
    if (frame) frame.destroy();
    super.remove();
  }

  /**
   * Initiates a kakaopay payment through AdyenCheckout
   */
  initiate () {
    const { adyenCheckout, adyenChallengeToken, container } = this;

    debug('Initializing challenge with Adyen token', adyenChallengeToken);

    const challengeService = adyenCheckout.createFromAction('threeDS2Challenge', {
      challengeToken: adyenChallengeToken,
      onComplete: results => this.emit('done', results),
      onError: cause => this.threeDSecure.error('3ds-auth-error', { cause }),
      size: '05'
    });

    challengeService.mount(container);
  }

  /**
   * Constructs a KakaoPay iframe
   *
   */
  fallback () {
    debug('Initiating KakaoPay iframe');
    const { adyenRedirectParams, container, threeDSecure } = this;
    const { recurly } = threeDSecure.risk;
    const payload = {
      redirect_url: adyenRedirectParams.url,
      ...adyenRedirectParams.data
    };
    //should be adyen redirect
    this.frame = recurly.Frame({ type: Frame.TYPES.IFRAME, path: '/three_d_secure/start', payload, container })
      .on('error', cause => threeDSecure.error('3ds-auth-error', { cause }))
      .on('done', results => this.emit('done', results));
  }

  /**
   * Loads Adyen library dependency
   */
  loadAdyenLibrary () {
    return new Promise((resolve, reject) => {
      if (window.AdyenCheckout) return resolve();
      loadScript(AdyenStrategy.libUrl, error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

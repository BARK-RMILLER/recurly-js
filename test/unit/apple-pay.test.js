import assert from 'assert';
import clone from 'component-clone';
import find from 'component-find';
import merge from 'lodash.merge';
import omit from 'lodash.omit';
import Emitter from 'component-emitter';
import Promise from 'promise';
import { initRecurly, apiTest, nextTick } from './support/helpers';
import { ApplePayBraintree } from '../../lib/recurly/apple-pay/apple-pay.braintree';
import filterSupportedNetworks from '../../lib/recurly/apple-pay/util/filter-supported-networks';

import infoFixture from '../server/fixtures/apple_pay/info';
import startFixture from '../server/fixtures/apple_pay/start';
import tokenFixture from '../server/fixtures/apple_pay/token';

const INTEGRATION = {
  DIRECT: 'Direct Integration',
  BRAINTREE: 'Braintree Integration',
};

class ApplePaySessionStub extends Emitter {
  constructor (version, paymentRequest) {
    super();
    this.version = version;
    Object.assign(this, paymentRequest);
  }
  begin () {}
  completeMerchantValidation (ms) {
    this.merchantSession = ms;
    this.emit('completeMerchantValidation');
  }
  completePaymentMethodSelection ({ newTotal: t, newLineItems: li }) {
    this.total = t;
    this.lineItems = li;
    this.emit('completePaymentMethodSelection');
  }
  completeShippingContactSelection ({ newTotal: t, newLineItems: li, newShippingMethods: sm }) {
    this.shippingMethods = sm;
    this.total = t;
    this.lineItems = li;
    this.emit('completeShippingContactSelection');
  }
  completeShippingMethodSelection ({ newTotal: t, newLineItems: li, newShippingMethods: sm }) {
    this.shippingMethods = sm;
    this.total = t;
    this.lineItems = li;
    this.emit('completeShippingMethodSelection');
  }
  completePayment ({ status }) {
    this.status = status;
    this.emit('completePayment');
  }

  static version = 4;
  static supportsVersion (version) {
    if (!this.version) return true;
    return this.version >= version;
  }
}
ApplePaySessionStub.canMakePayments = () => true;

const getBraintreeStub = () => ({
  client: {
    VERSION: '3.76.0',
    create: sinon.stub().resolves('CLIENT'),
  },
  dataCollector: {
    create: sinon.stub().resolves({ deviceData: 'DEVICE_DATA' }),
  },
  applePay: {
    create: sinon.stub().resolves({
      performValidation: sinon.stub().resolves('MERCHANT_SESSION'),
      tokenize: sinon.stub().resolves('TOKENIZED_PAYLOAD'),
      teardown: sinon.stub().resolves('TEARDOWN'),
    }),
  },
});

describe('ApplePay', function () {
  beforeEach(function () {
    this.sandbox = sinon.createSandbox();
    this.isIE = !!document.documentMode;
    if (this.isIE) {
      window.Promise = Promise;
    }
    window.ApplePaySession = ApplePaySessionStub;
  });

  afterEach(function () {
    this.sandbox.restore();
    if (this.isIE) {
      delete window.Promise;
    }
    delete window.ApplePaySession;
  });

  describe('filterSupportedNetworks', function () {
    it('keeps networks that are compatible on the browser version', function () {
      this.sandbox.stub(ApplePaySessionStub, 'version').value(4);
      assert.deepEqual(filterSupportedNetworks(['visa', 'jcb', 'mir']), ['visa', 'jcb']);
    });

    it('rejects networks that are not compatible on the browser version', function () {
      this.sandbox.stub(ApplePaySessionStub, 'version').value(12);
      assert.deepEqual(filterSupportedNetworks(['visa', 'jcb', 'mir']), ['visa', 'jcb', 'mir']);
    });
  });

  apiTest(applePayTest.bind(null, INTEGRATION.DIRECT));
  apiTest(applePayTest.bind(null, INTEGRATION.BRAINTREE));
});

function applePayTest (integrationType, requestMethod) {
  const isDirectIntegration = integrationType === INTEGRATION.DIRECT;
  const isBraintreeIntegration = integrationType === INTEGRATION.BRAINTREE;

  describe(`Recurly.ApplePay ${integrationType} (${requestMethod})`, function () {
    let validOpts = {
      country: 'US',
      currency: 'USD',
      label: 'Apple Pay test',
      total: '3.49',
      form: {},
      ...(isBraintreeIntegration && { braintree: { clientAuthorization: 'valid' } }),
    };

    beforeEach(function () {
      this.recurly = initRecurly({ cors: requestMethod === 'cors' });
      if (isBraintreeIntegration) {
        window.braintree = getBraintreeStub();
      }
    });

    afterEach(function () {
      delete window.braintree;
    });

    describe('Constructor', function () {
      describe('when Apple Pay is not supported', function () {
        beforeEach(function () {
          delete window.ApplePaySession;
          this.applePay = this.recurly.ApplePay(validOpts);
        });

        it('registers an Apple Pay not supported error', function () {
          assertInitError(this.applePay, 'apple-pay-not-supported');
        });

        describe('ApplePay.begin', function () {
          it('returns an initialization error', function () {
            let result = this.applePay.begin();
            assert.equal(result.code, 'apple-pay-init-error');
            assert.equal(result.err.code, 'apple-pay-not-supported');
          });
        });
      });

      describe('when Apple Pay is not set up', function () {
        beforeEach(function () {
          this.sandbox.stub(ApplePaySessionStub, 'canMakePayments').returns(false);
          this.applePay = this.recurly.ApplePay(clone(validOpts));
        });

        it('registers an Apple Pay not available error', function () {
          assertInitError(this.applePay, 'apple-pay-not-available');
        });

        describe('ApplePay.begin', function () {
          it('returns an initialization error', function () {
            let result = this.applePay.begin();
            assert.equal(result.code, 'apple-pay-init-error');
            assert.equal(result.err.code, 'apple-pay-not-available');
          });
        });
      });

      describe('when Apple Pay version not supported', function () {
        beforeEach(function () {
          this.sandbox.stub(ApplePaySessionStub, 'version').value(2);
          this.applePay = this.recurly.ApplePay(clone(validOpts));
        });

        it('registers an Apple Pay not supported error', function () {
          assertInitError(this.applePay, 'apple-pay-not-supported');
        });

        describe('ApplePay.begin', function () {
          it('returns an initialization error', function () {
            let result = this.applePay.begin();
            assert.equal(result.code, 'apple-pay-init-error');
            assert.equal(result.err.code, 'apple-pay-not-supported');
          });
        });
      });

      it('sets options.label as the i18n total', function (done) {
        let options = omit(validOpts, 'label');
        options.label = 'Label';
        let applePay = this.recurly.ApplePay(options);

        applePay.ready(ensureDone(done, () => {
          assert.equal(applePay.config.i18n.totalLineItemLabel, options.label);
          assert.equal(applePay.config.i18n.totalLineItemLabel, 'Label');
        }));
      });

      describe('when not given options.pricing', function () {
        it('requires options.total', function (done) {
          let applePay = this.recurly.ApplePay(omit(validOpts, 'total'));
          applePay.on('error', function (err) {
            nextTick(ensureDone(done, () => {
              assert.equal(err, applePay.initError);
              assertInitError(applePay, 'apple-pay-config-missing', { opt: 'total' });
            }));
          });
        });

        it('creates the total line item from options.total and the default options.label if absent', function (done) {
          let applePay = this.recurly.ApplePay(omit(validOpts, 'label'));
          applePay.ready(ensureDone(done, () => {
            assert.equal(applePay.session.total.amount, validOpts.total);
            assert.equal(applePay.session.total.label, applePay.config.i18n.totalLineItemLabel);
            assert.equal(applePay.session.total.label, 'Total');
          }));
        });

        it('creates the total line item from options.total and options.label', function (done) {
          let applePay = this.recurly.ApplePay(clone(validOpts));
          applePay.ready(ensureDone(done, () => {
            assert.equal(applePay.session.total.amount, validOpts.total);
            assert.equal(applePay.session.total.label, validOpts.label);
            assert.equal(applePay.session.label, undefined);
          }));
        });

        it('uses options.total as the total line item', function (done) {
          let options = omit(validOpts, 'total');
          options.total = { label: 'Subscription', amount: '10.00' };
          let applePay = this.recurly.ApplePay(options);
          applePay.ready(ensureDone(done, () => {
            assert.equal(applePay.session.total, options.total);
          }));
        });

        it('uses options.lineItems as the line items', function (done) {
          let options = clone(validOpts);
          options.lineItems = [{ label: 'Taxes', amount: '10.00' }, { label: 'Discount', amount: '-10.00' }];
          let applePay = this.recurly.ApplePay(options);
          applePay.ready(ensureDone(done, () => {
            assert.equal(applePay.session.lineItems, options.lineItems);
          }));
        });
      });

      describe('when given options.pricing', function () {
        beforeEach(function () {
          const pricing = this.pricing = this.recurly.Pricing.Checkout();
          this.applePay = this.recurly.ApplePay(merge({}, validOpts, { pricing }));
        });

        it('binds a pricing instance', function (done) {
          this.applePay.ready(ensureDone(done, () => {
            assert.strictEqual(this.applePay.config.pricing, this.pricing);
            assert.equal(this.applePay.session.pricing, undefined);
          }));
        });

        it('ignores options.total and options.lineItems', function (done) {
          const lineItems = [{ label: 'Taxes', amount: '10.00' }];
          this.applePay = this.recurly.ApplePay(merge({}, validOpts, {
            pricing: this.pricing,
            lineItems
          }));

          this.applePay.ready(ensureDone(done, () => {
            assert.notEqual(this.applePay.totalLineItem.amount, validOpts.total);
            assert.notDeepEqual(this.applePay.lineItems, lineItems);
          }));
        });

        describe('when options.pricing is a PricingPromise', () => {
          beforeEach(function () {
            const { recurly } = this;
            const pricing = this.pricing = recurly.Pricing.Checkout();
            const pricingPromise = this.pricingPromise = pricing.reprice();
            this.applePay = recurly.ApplePay(merge({}, validOpts, { pricing: pricingPromise }));
          });

          it('uses the underlying Pricing instance', function (done) {
            const { pricing, applePay } = this;
            applePay.ready(() => {
              assert.strictEqual(applePay.config.pricing, pricing);
              assert.strictEqual(applePay.totalLineItem.amount, pricing.totalNow);
              assert.strictEqual(applePay.totalLineItem.amount, '0.00');

              pricing.adjustment({ amount: 10 }).done(ensureDone(done, () => {
                assert.strictEqual(applePay.totalLineItem.amount, pricing.totalNow);
                assert.strictEqual(applePay.totalLineItem.amount, '10.00');
              }));
            });
          });
        });

        describe('when the pricing instance includes several items', () => {
          beforeEach(function (done) {
            this.timeout(10000);
            this.subscription = this.recurly.Pricing.Subscription()
              .plan('basic')
              .address({ country: 'US', postalCode: '94117' })
              .done(() => {
                this.pricing
                  .subscription(this.subscription)
                  .adjustment({ amount: 100 })
                  .coupon('coop')
                  .giftCard('super-gift-card')
                  .done(() => done());
              });
          });

          it('includes relevant line items', function () {
            const subtotal = this.applePay.lineItems[0];
            const discount = this.applePay.lineItems[1];
            const giftCard = this.applePay.lineItems[2];
            const total = this.applePay.totalLineItem;
            assert.strictEqual(this.applePay.lineItems.length, 3);
            assert.strictEqual(total.label, this.applePay.config.i18n.totalLineItemLabel);
            assert.strictEqual(subtotal.label, this.applePay.config.i18n.subtotalLineItemLabel);
            assert.strictEqual(discount.label, this.applePay.config.i18n.discountLineItemLabel);
            assert.strictEqual(giftCard.label, this.applePay.config.i18n.giftCardLineItemLabel);
            assert.strictEqual(subtotal.amount, '121.99');
            assert.strictEqual(discount.amount, '-20.00');
            assert.strictEqual(giftCard.amount, '-20.00');
            assert.strictEqual(total.amount, '81.99');
          });

          describe('when the line item labels are customized', () => {
            beforeEach(function () {
              this.exampleI18n = {
                totalLineItemLabel: 'Custom total label',
                subtotalLineItemLabel: 'Custom subtotal label',
                discountLineItemLabel: 'Custom discount label',
                taxLineItemLabel: 'Custom tax label',
                giftCardLineItemLabel: 'Custom Gift card label'
              };
            });

            it('displays those labels', function (done) {
              const applePay = this.recurly.ApplePay(merge({}, validOpts, { pricing: this.pricing, i18n: this.exampleI18n }));
              applePay.on('ready', ensureDone(done, () => {
                const total = applePay.totalLineItem;
                const subtotal = applePay.lineItems[0];
                const discount = applePay.lineItems[1];
                const giftCard = applePay.lineItems[2];
                assert.equal(total.label, this.exampleI18n.totalLineItemLabel);
                assert.equal(subtotal.label, this.exampleI18n.subtotalLineItemLabel);
                assert.equal(discount.label, this.exampleI18n.discountLineItemLabel);
                assert.equal(giftCard.label, this.exampleI18n.giftCardLineItemLabel);
                assert.equal(applePay.session.i18n, undefined);
              }));
            });
          });

          describe('when tax amounts are specified', () => {
            beforeEach(function (done) {
              this.pricing.tax({ amount: { now: 20.01, next: 18.46 } }).done(() => done());
            });

            it('sets the tax line item accordingly', function () {
              const taxLineItem = find(this.applePay.lineItems, li => li.label === this.applePay.config.i18n.taxLineItemLabel);
              assert.strictEqual(taxLineItem.amount, '20.01');
            });
          });
        });
      });

      it('requires a valid country', function (done) {
        const invalid = 'DE';
        let applePay = this.recurly.ApplePay(merge({}, validOpts, { country: invalid }));
        applePay.on('error', (err) => {
          nextTick(ensureDone(done, () => {
            assert.equal(err, applePay.initError);
            assertInitError(applePay, 'apple-pay-config-invalid', { opt: 'country' });
          }));
        });
      });

      it('requires a valid currency', function (done) {
        const invalid = 'EUR';
        let applePay = this.recurly.ApplePay(merge({}, validOpts, { currency: invalid }));
        applePay.on('error', (err) => {
          nextTick(ensureDone(done, () => {
            assert.equal(err, applePay.initError);
            assertInitError(applePay, 'apple-pay-config-invalid', { opt: 'currency' });
          }));
        });
      });

      describe('options.enforceVersion', function () {
        it('returns an initError if the browser version for requiredShippingContactFields is not met', function (done) {
          this.sandbox.stub(ApplePaySessionStub, 'version').value(4);
          let applePay = this.recurly.ApplePay(merge({}, validOpts, {
            enforceVersion: true, requiredShippingContactFields: ['email']
          }));

          applePay.on('error', (err) => {
            nextTick(ensureDone(done, () => {
              assert.equal(err, applePay.initError);
              assertInitError(applePay, 'apple-pay-not-supported');
            }));
          });
        });

        it('sets requiredShippingContactFields if the browser version is met', function (done) {
          this.sandbox.stub(ApplePaySessionStub, 'version').value(14);
          let applePay = this.recurly.ApplePay(merge({}, validOpts, {
            enforceVersion: true, requiredShippingContactFields: ['email']
          }));

          applePay.ready(ensureDone(done, () => {
            assert.deepEqual(applePay.session.requiredShippingContactFields, ['email']);
            assert.equal(applePay.session.enforceVersion, undefined);
          }));
        });
      });

      it('sets other ApplePayPaymentRequest options and does not include configuration options', function (done) {
        const applePay = this.recurly.ApplePay(merge({}, validOpts, {
          requiredShippingContactFields: ['email'],
          supportedCountries: ['US'],
        }));

        applePay.ready(ensureDone(done, () => {
          assert.deepEqual(applePay.session.requiredShippingContactFields, ['email']);
          assert.deepEqual(applePay.session.supportedCountries, ['US']);
          assert.equal(applePay.session.currencyCode, validOpts.currency);
          assert.equal(applePay.session.countryCode, validOpts.country);
          assert.equal(applePay.session.currency, undefined);
          assert.equal(applePay.session.country, undefined);
          assert.equal(applePay.session.form, undefined);
        }));
      });

      describe('merchant info collection', function () {
        beforeEach(function () {
          this.applePay = this.recurly.ApplePay(validOpts);
        });

        it('assigns the applicationData', function (done) {
          this.applePay.ready(ensureDone(done, () => {
            assert.equal(this.applePay.session.applicationData, btoa('test'));
          }));
        });

        it('assigns merchantCapabilities', function (done) {
          this.applePay.ready(ensureDone(done, () => {
            assert.deepEqual(this.applePay.session.merchantCapabilities, infoFixture.merchantCapabilities);
          }));
        });

        it('assigns supportedNetworks', function (done) {
          this.applePay.ready(ensureDone(done, () => {
            assert.deepEqual(this.applePay.session.supportedNetworks, infoFixture.supportedNetworks);
          }));
        });

        it('limits the supportedNetworks to the configuration', function (done) {
          const applePay = this.recurly.ApplePay(merge({}, validOpts, {
            supportedNetworks: ['visa'],
          }));
          applePay.ready(ensureDone(done, () => {
            assert.deepEqual(applePay.session.supportedNetworks, ['visa']);
          }));
        });
      });

      describe('billingContact', function () {
        const billingContact = {
          givenName: 'Emmet',
          familyName: 'Brown',
          addressLines: ['1640 Riverside Drive', 'Suite 1'],
          locality: 'Hill Valley',
          administrativeArea: 'CA',
          postalCode: '91103',
          countryCode: 'US'
        };

        const billingAddress = {
          first_name: billingContact.givenName,
          last_name: billingContact.familyName,
          address1: billingContact.addressLines[0],
          address2: billingContact.addressLines[1],
          city: billingContact.locality,
          state: billingContact.administrativeArea,
          postal_code: billingContact.postalCode,
          country: billingContact.countryCode,
        };

        it('populates with the form address fields when available', function (done) {
          const applePay = this.recurly.ApplePay(merge({}, validOpts, { form: billingAddress }));
          applePay.ready(ensureDone(done, () => {
            assert.deepEqual(applePay.session.billingContact, billingContact);
            assert.equal(applePay.session.shippingContact, undefined);
          }));
        });

        it('populates with the pricing address when available', function (done) {
          const pricing = this.recurly.Pricing.Checkout();
          const applePay = this.recurly.ApplePay(merge({}, validOpts, { pricing }));
          pricing.address(billingAddress).done(() => {
            applePay.ready(ensureDone(done, () => {
              assert.deepEqual(applePay.session.billingContact, billingContact);
              assert.equal(applePay.session.shippingContact, undefined);
            }));
          });
        });

        it('prefers the override if the form/pricing is populated', function (done) {
          const form = {
            first_name: 'Bobby',
            last_name: 'Brown',
            city: 'Mill Valley',
          };
          const pricing = this.recurly.Pricing.Checkout();
          pricing.address(form).done(() => {
            const applePay = this.recurly.ApplePay(merge({}, validOpts, { form, pricing, billingContact }));
            applePay.ready(ensureDone(done, () => {
              assert.deepEqual(applePay.session.billingContact, billingContact);
              assert.equal(applePay.session.shippingContact, undefined);
            }));
          });
        });

        it('omits if there is no form or override', function (done) {
          const applePay = this.recurly.ApplePay(validOpts);
          applePay.ready(ensureDone(done, () => {
            assert.equal(applePay.session.billingContact, undefined);
          }));
        });
      });

      describe('shippingContact', function () {
        const shippingContact = { phoneNumber: '5555555555', };
        const shippingAddress = { phone: '5555555555', };

        it('populates with the form address fields when available', function (done) {
          const applePay = this.recurly.ApplePay(merge({}, validOpts, { form: shippingAddress }));
          applePay.ready(ensureDone(done, () => {
            assert.deepEqual(applePay.session.shippingContact, shippingContact);
            assert.equal(applePay.session.billingContact, undefined);
          }));
        });

        it('populates with the pricing shipping address when available', function (done) {
          const pricing = this.recurly.Pricing.Checkout();
          pricing.shippingAddress(shippingAddress).done(() => {
            const applePay = this.recurly.ApplePay(merge({}, validOpts, { pricing }));
            applePay.ready(ensureDone(done, () => {
              assert.deepEqual(applePay.session.shippingContact, shippingContact);
              assert.equal(applePay.session.billingContact, undefined);
            }));
          });
        });

        it('populates the shipping address with the address phone number', function (done) {
          const phone = '3333333333';
          const pricing = this.recurly.Pricing.Checkout();
          pricing.address({ phone }).done(() => {
            const applePay = this.recurly.ApplePay(merge({}, validOpts, { pricing }));
            applePay.ready(ensureDone(done, () => {
              assert.deepEqual(applePay.session.shippingContact, { phoneNumber: phone, });
            }));
          });
        });

        describe('with pricing that has both a shipping address and phone number from the address', function () {
          const phone = '3333333333';
          const fullShippingAddress = {
            first_name: 'Bobby',
            last_name: 'Brown',
            city: 'Mill Valley',
          };

          it('populates with the pricing address phone number when available', function (done) {
            const pricing = this.recurly.Pricing.Checkout();
            pricing.address({ phone }).shippingAddress(fullShippingAddress).done(() => {
              const applePay = this.recurly.ApplePay(merge({}, validOpts, { pricing }));
              applePay.ready(ensureDone(done, () => {
                assert.equal(applePay.session.billingContact, undefined);
                assert.deepEqual(applePay.session.shippingContact, {
                  phoneNumber: phone,
                  givenName: 'Bobby',
                  familyName: 'Brown',
                  locality: 'Mill Valley',
                });
              }));
            });
          });

          it('uses the shippingAddress phone number over the address', function (done) {
            const pricing = this.recurly.Pricing.Checkout();
            pricing.address({ phone }).shippingAddress({ ...fullShippingAddress, ...shippingAddress })
              .done(() => {
                const applePay = this.recurly.ApplePay(merge({}, validOpts, { pricing }));
                applePay.ready(ensureDone(done, () => {
                  assert.deepEqual(applePay.session.shippingContact, {
                    givenName: 'Bobby',
                    familyName: 'Brown',
                    locality: 'Mill Valley',
                    ...shippingContact,
                  });
                }));
              });
          });
        });

        it('prefers the override if the form/pricing is populated', function (done) {
          const form = {
            phone: '3333333333',
          };

          const pricing = this.recurly.Pricing.Checkout();
          pricing.shippingAddress(form).done(() => {
            const applePay = this.recurly.ApplePay(merge({}, validOpts, { form, pricing, shippingContact }));
            applePay.ready(ensureDone(done, () => {
              assert.deepEqual(applePay.session.shippingContact, shippingContact);
            }));
          });
        });

        it('omits if there is no form or override', function (done) {
          const applePay = this.recurly.ApplePay(validOpts);
          applePay.ready(ensureDone(done, () => {
            assert.equal(applePay.session.shippingContact, undefined);
          }));
        });
      });

      it('emits ready when done', function (done) {
        this.recurly.ApplePay(validOpts).on('ready', done);
      });

      if (isBraintreeIntegration) {
        describe('when the libs are not loaded', function () {
          beforeEach(function () {
            delete window.braintree;
            this.sandbox.stub(ApplePayBraintree, 'libUrl').returns('/api/mock-200');
          });

          it('load the libs', function (done) {
            const applePay = this.recurly.ApplePay(validOpts);
            applePay.on('error', ensureDone(done, () => {
              assert.equal(ApplePayBraintree.libUrl.callCount, 3);
              assert.equal(ApplePayBraintree.libUrl.getCall(0).args[0], 'client');
              assert.equal(ApplePayBraintree.libUrl.getCall(1).args[0], 'applePay');
              assert.equal(ApplePayBraintree.libUrl.getCall(2).args[0], 'dataCollector');
            }));
          });
        });

        const requiredBraintreeLibs = ['client', 'dataCollector', 'applePay'];
        requiredBraintreeLibs.forEach(requiredLib => {
          describe(`when failed to load the braintree ${requiredLib} lib`, function () {
            beforeEach(function () {
              delete window.braintree;
              this.sandbox.stub(ApplePayBraintree, 'libUrl').withArgs(requiredLib).returns('/api/mock-404');
            });

            it('register an initialization error', function (done) {
              const applePay = this.recurly.ApplePay(validOpts);

              applePay.on('error', (err) => {
                nextTick(ensureDone(done, () => {
                  assert.equal(err, applePay.initError);
                  assertInitError(applePay, 'apple-pay-init-error');
                }));
              });
            });
          });

          describe(`when failed to create the ${requiredLib} instance`, function () {
            beforeEach(function () {
              window.braintree[requiredLib].create = sinon.stub().rejects('error');
            });

            it('register an initialization error', function (done) {
              const applePay = this.recurly.ApplePay(validOpts);

              applePay.on('error', (err) => {
                nextTick(ensureDone(done, () => {
                  assert.equal(err, applePay.initError);
                  assertInitError(applePay, 'apple-pay-init-error');
                }));
              });
            });
          });
        });

        it('assigns the braintree configuration', function (done) {
          const applePay = this.recurly.ApplePay(validOpts);

          applePay.on('ready', () => {
            nextTick(ensureDone(done, () => {
              assert.ok(applePay.braintree.dataCollector);
              assert.ok(applePay.braintree.applePay);
            }));
          });
        });
      }
    });

    describe('ApplePay.ready', function () {
      it('calls the callback once instantiated', function (done) {
        this.recurly.ApplePay(validOpts).ready(done);
      });
    });

    describe('ApplePay.begin', function () {
      it('aborts if there is an initError', function () {
        // expect empty options to induce an initError
        let applePay = this.recurly.ApplePay();
        let result = applePay.begin();
        assert(result instanceof Error);
        assert.equal(result.code, 'apple-pay-init-error');
        assert.equal(result.err.code, applePay.initError.code);
      });

      it('establishes a session and initiates it', function (done) {
        let applePay = this.recurly.ApplePay(validOpts);
        applePay.on('ready', ensureDone(done, () => {
          applePay.begin();
          assert(applePay.session instanceof ApplePaySessionStub);
        }));
      });

      it('establishes a session and initiates it without options.form', function (done) {
        let applePay = this.recurly.ApplePay(omit(validOpts, 'form'));
        applePay.on('ready', ensureDone(done, () => {
          applePay.begin();
          assert(applePay.session instanceof ApplePaySessionStub);
        }));
      });
    });

    describe('onPricingChange', function () {
      beforeEach(function () {
        this.pricing = this.recurly.Pricing();
      });

      it('updates the total to reflect Pricing changes', function (done) {
        let applePay = this.recurly.ApplePay(merge({}, validOpts, { pricing: this.pricing }));
        applePay.on('ready', () => {
          let originalTotal = clone(applePay.totalLineItem);
          this.pricing.on('change', ensureDone(done, () => {
            assert.notDeepEqual(originalTotal, applePay.totalLineItem);
          }));
          this.pricing.plan('basic', { quantity: 1 }).done();
        });
      });
    });

    describe('internal event handlers', function () {
      beforeEach(function (done) {
        this.applePay = this.recurly.ApplePay(validOpts);
        this.applePay.ready(ensureDone(done, () => {
          this.applePay.begin();
        }));
      });

      describe('onValidateMerchant', function () {
        if (isDirectIntegration) {
          it('calls the merchant validation endpoint and passes the result to the ApplePaySession', function (done) {
            this.applePay.session.on('completeMerchantValidation', ensureDone(done, () => {
              assert.equal(typeof this.applePay.session.merchantSession, 'object');
              assert.equal(this.applePay.session.merchantSession.merchantSessionIdentifier, startFixture.ok.merchantSessionIdentifier);
            }));
            this.applePay.session.onvalidatemerchant({ validationURL: 'valid-test-url' });
          });
        }

        if (isBraintreeIntegration) {
          beforeEach(function () {
            this.spyStartRequest = this.sandbox.spy(this.recurly.request, 'post');
          });

          it('do not call the merchant validation start endpoint', function (done) {
            this.applePay.session.on('completeMerchantValidation', ensureDone(done, () => {
              assert.equal(this.spyStartRequest.called, false);
            }));
            this.applePay.session.onvalidatemerchant({ validationURL: 'valid-test-url' });
          });

          it('calls the braintree performValidation with the validation url', function (done) {
            this.applePay.session.on('completeMerchantValidation', ensureDone(done, () => {
              assert.ok(this.applePay.braintree.applePay.performValidation.calledWith({
                validationURL: 'valid-test-url',
                displayName: 'My Store'
              }));
            }));
            this.applePay.session.onvalidatemerchant({ validationURL: 'valid-test-url' });
          });

          it('calls the completeMerchantValidation with the merchant session', function (done) {
            const completeMerchantValidationSpy = this.sandbox.spy(this.applePay.session, 'completeMerchantValidation');
            this.applePay.session.on('completeMerchantValidation', ensureDone(done, () => {
              assert.ok(completeMerchantValidationSpy.calledWith('MERCHANT_SESSION'));
            }));
            this.applePay.session.onvalidatemerchant({ validationURL: 'valid-test-url' });
          });

          it('emits an error if the braintree performValidation fails', function (done) {
            this.applePay.braintree.applePay.performValidation = this.sandbox.stub().rejects('error');
            const completeMerchantValidationSpy = this.sandbox.spy(this.applePay.session, 'completeMerchantValidation');

            this.applePay.session.onvalidatemerchant({ validationURL: 'valid-test-url' });

            this.applePay.on('error', ensureDone(done, (err) => {
              assert.equal(completeMerchantValidationSpy.called, false);
              assert.equal(err, 'error');
            }));
          });
        }
      });

      describe('onPaymentMethodSelected', function () {
        it('calls ApplePaySession.completePaymentSelection with a total and line items', function (done) {
          this.applePay.session.on('completePaymentMethodSelection', ensureDone(done, () => {
            assert.deepEqual(this.applePay.session.total, this.applePay.finalTotalLineItem);
            assert.deepEqual(this.applePay.session.lineItems, this.applePay.lineItems);
          }));
          this.applePay.session.onpaymentmethodselected({ paymentMethod: { billingContact: { postalCode: '94114' } } });
        });

        describe('with options.pricing set', function () {
          beforeEach(function (done) {
            this.pricing = this.recurly.Pricing.Checkout();
            this.applePay = this.recurly.ApplePay(merge({}, validOpts, { pricing: this.pricing }));
            this.pricing.adjustment({ amount: 10 }).done(() => {
              this.applePay.ready(done);
            });
          });

          it('reprices when the billingContact is selected', function (done) {
            const spy = this.sandbox.spy(this.pricing, 'reprice');
            this.applePay.session.on('completePaymentMethodSelection', ensureDone(done, () => {
              assert.deepEqual(this.pricing.items.address, { postal_code: '94110', country: 'US' });
              assert.deepEqual(this.applePay.session.total, this.applePay.finalTotalLineItem);
              assert.deepEqual(this.applePay.session.lineItems, this.applePay.lineItems);
              assert.equal(this.applePay.session.lineItems[1].label, 'Tax');
              assert.equal(this.applePay.session.lineItems[1].amount, this.pricing.price.now.taxes);
              assert(spy.called, 'should have repriced');
            }));

            this.applePay.session.onpaymentmethodselected({
              paymentMethod: { billingContact: { postalCode: '94110', countryCode: 'US' } }
            });
          });
        });
      });

      describe('onShippingContactSelected', function () {
        it('calls ApplePaySession.completeShippingContactSelection with empty methods, a total, and line items', function (done) {
          this.applePay.session.on('completeShippingContactSelection', ensureDone(done, () => {
            assert(Array.isArray(this.applePay.session.shippingMethods));
            assert.equal(this.applePay.session.shippingMethods.length, 0);
            assert.deepEqual(this.applePay.session.total, this.applePay.finalTotalLineItem);
            assert.deepEqual(this.applePay.session.lineItems, this.applePay.lineItems);
          }));
          this.applePay.session.onshippingcontactselected({});
        });

        it('emits shippingContactSelected', function (done) {
          const example = { shippingContact: { postalCode: '94114' } };
          this.applePay.on('shippingContactSelected', ensureDone(done, (event) => {
            assert.deepEqual(event, example);
          }));
          this.applePay.session.onshippingcontactselected(example);
        });

        describe('with options.pricing set', function () {
          beforeEach(function (done) {
            this.pricing = this.recurly.Pricing.Checkout();
            this.applePay = this.recurly.ApplePay(merge({}, validOpts, { pricing: this.pricing }));
            this.pricing.adjustment({ amount: 10 }).done(() => {
              this.applePay.ready(done);
            });
          });

          it('reprices when the shippingContact is selected', function (done) {
            const spy = this.sandbox.spy(this.pricing, 'reprice');

            this.applePay.session.on('completeShippingContactSelection', ensureDone(done, () => {
              assert.deepEqual(this.pricing.items.shippingAddress, { postal_code: '94110', country: 'US' });
              assert.deepEqual(this.applePay.session.total, this.applePay.finalTotalLineItem);
              assert.deepEqual(this.applePay.session.lineItems, this.applePay.lineItems);
              assert.equal(this.applePay.session.lineItems[1].label, 'Tax');
              assert.equal(this.applePay.session.lineItems[1].amount, this.pricing.price.now.taxes);
              assert(spy.called, 'should have repriced');
            }));

            this.applePay.session.onshippingcontactselected({
              shippingContact: { postalCode: '94110', countryCode: 'US' }
            });
          });
        });
      });

      describe('onShippingMethodSelected', function () {
        it('calls ApplePaySession.completeShippingMethodSelection with status, a total, and line items', function (done) {
          this.applePay.session.on('completeShippingMethodSelection', ensureDone(done, () => {
            assert(Array.isArray(this.applePay.session.shippingMethods));
            assert.equal(this.applePay.session.shippingMethods.length, 0);
            assert.deepEqual(this.applePay.session.total, this.applePay.finalTotalLineItem);
            assert.deepEqual(this.applePay.session.lineItems, this.applePay.lineItems);
          }));
          this.applePay.session.onshippingmethodselected();
        });

        it('emits shippingMethodSelected', function (done) {
          const example = { test: 'event' };
          this.applePay.on('shippingMethodSelected', ensureDone(done, (event) => {
            assert.deepEqual(event, example);
          }));
          this.applePay.session.onshippingmethodselected(example);
        });
      });

      describe('onPaymentAuthorized', function () {
        const billingContact = {
          givenName: 'Emmet',
          familyName: 'Brown',
          addressLines: ['1640 Riverside Drive', 'Suite 1'],
          locality: 'Hill Valley',
          administrativeArea: 'CA',
          postalCode: '91103',
          countryCode: 'US',
        };

        const billingAddress = {
          first_name: billingContact.givenName,
          last_name: billingContact.familyName,
          address1: billingContact.addressLines[0],
          address2: billingContact.addressLines[1],
          city: billingContact.locality,
          state: billingContact.administrativeArea,
          postal_code: billingContact.postalCode,
          country: billingContact.countryCode,
        };

        const inputNotAddressFields = {
          tax_identifier: 'tax123',
          tax_identifier_type: 'cpf',
        };

        const validAuthorizeEvent = {
          payment: {
            billingContact: billingContact,
            token: {
              paymentData: 'valid-payment-data',
              paymentMethod: 'valid-payment-method',
            }
          }
        };

        it('completes payment', function (done) {
          this.applePay.session.onpaymentauthorized(clone(validAuthorizeEvent));
          this.applePay.session.on('completePayment', ensureDone(done, () => {
            assert.equal(this.applePay.session.status, this.applePay.session.STATUS_SUCCESS);
          }));
        });

        it('emits a token event', function (done) {
          this.applePay.session.onpaymentauthorized(clone(validAuthorizeEvent));
          this.applePay.on('token', ensureDone(done, (token) => {
            assert.deepEqual(token, tokenFixture.ok);
          }));
        });

        it('emits paymentAuthorized', function (done) {
          const example = clone(validAuthorizeEvent);
          this.applePay.on('paymentAuthorized', ensureDone(done, (event) => {
            assert.deepEqual(event, example);
          }));
          this.applePay.session.onpaymentauthorized(example);
        });

        if (isDirectIntegration) {
          it('pass the expected parameters to create the token', function (done) {
            this.spyTokenRequest = this.sandbox.spy(this.recurly.request, 'post');

            this.applePay.session.onpaymentauthorized(clone(validAuthorizeEvent));
            this.applePay.on('token', ensureDone(done, () => {
              const args = this.spyTokenRequest.getCall(0).args[0];
              assert.deepEqual(args.data, {
                paymentData: 'valid-payment-data',
                paymentMethod: 'valid-payment-method',
                ...billingAddress,
              });
            }));
          });

          it('passes the non address parameters to create the token', function (done) {
            this.spyTokenRequest = this.sandbox.spy(this.recurly.request, 'post');
            this.applePay.config.form = clone(inputNotAddressFields);
            this.applePay.begin(); // the form has changed!

            this.applePay.session.onpaymentauthorized(clone(validAuthorizeEvent));
            this.applePay.on('token', ensureDone(done, () => {
              const args = this.spyTokenRequest.getCall(0).args[0];
              assert.deepEqual(args.data, {
                paymentData: 'valid-payment-data',
                paymentMethod: 'valid-payment-method',
                ...inputNotAddressFields,
                ...billingAddress,
              });
            }));
          });
        }

        if (isBraintreeIntegration) {
          it('pass the expected parameters to create the token', function (done) {
            this.spyTokenRequest = this.sandbox.spy(this.recurly.request, 'post');

            this.applePay.session.onpaymentauthorized(clone(validAuthorizeEvent));
            this.applePay.on('token', ensureDone(done, () => {
              const args = this.spyTokenRequest.getCall(0).args[0];
              assert.deepEqual(args.data, {
                type: 'braintree',
                payload: {
                  deviceData: 'DEVICE_DATA',
                  tokenizePayload: 'TOKENIZED_PAYLOAD',
                  applePayPayment: {
                    paymentData: 'valid-payment-data',
                    paymentMethod: 'valid-payment-method',
                    ...billingAddress,
                  },
                }
              });
            }));
          });
        }

        describe('when payment data is invalid', function () {
          const invalidAuthorizeEvent = {
            payment: {
              token: {
                paymentData: 'invalid-payment-data'
              }
            }
          };

          it('completes payment with a failure code', function (done) {
            this.applePay.session.onpaymentauthorized(clone(invalidAuthorizeEvent));
            this.applePay.session.on('completePayment', ensureDone(done, () => {
              assert.equal(this.applePay.session.status, this.applePay.session.STATUS_FAILURE);
            }));
          });

          it('emits an error event', function (done) {
            this.applePay.session.onpaymentauthorized(clone(invalidAuthorizeEvent));
            this.applePay.on('error', ensureDone(done, err => {
              assert.equal(err.code, tokenFixture.error.error.code);
              assert.equal(err.message, tokenFixture.error.error.message);
            }));
          });
        });
      });

      describe('onCancel', function () {
        it('emits onCancel', function (done) {
          const example = { test: 'event' };
          this.applePay.on('cancel', ensureDone(done, (event) => {
            assert.deepEqual(event, example);
          }));
          this.applePay.session.oncancel(example);
        });

        ['address', 'shippingAddress'].forEach(function (addressType) {
          describe(`with options.pricing set and ${addressType} configured`, function () {
            beforeEach(function (done) {
              this.pricing = this.recurly.Pricing.Checkout();
              this.applePay = this.recurly.ApplePay(merge({}, validOpts, { pricing: this.pricing }));
              this.pricing[addressType]({ postalCode: '91411', countryCode: 'US' }).done(() => {
                this.applePay.ready(() => {
                  this.applePay.begin();
                  done();
                });
              });
            });

            it(`does not reprice if the ${addressType} has not changed`, function (done) {
              const spy = this.sandbox.spy(this.pricing, 'reprice');

              this.applePay.on('cancel', ensureDone(done, () => {
                assert.equal(this.pricing.items[addressType].postalCode, '91411');
                assert.equal(this.pricing.items[addressType].countryCode, 'US');
                assert(!spy.called, 'should not have repriced');
              }));
              this.applePay.session.oncancel({});
            });

            it(`restores the pricing ${addressType} and repricings`, function (done) {
              const spy = this.sandbox.spy(this.pricing, 'reprice');
              this.applePay.on('cancel', ensureDone(done, () => {
                assert.equal(this.pricing.items[addressType].postalCode, '91411');
                assert.equal(this.pricing.items[addressType].countryCode, 'US');
                assert(spy.called, 'should have repriced');
              }));

              this.pricing[addressType]({ postalCode: '91423', countryCode: 'US' })
                .done(() => this.applePay.session.oncancel({}));
            });
          });
        });

        if (isBraintreeIntegration) {
          it('teardown braintree', function (done) {
            this.applePay.on('cancel', ensureDone(done, () => {
              assert.ok(this.applePay.braintree.applePay.teardown.called);
            }));
            this.applePay.session.oncancel('event');
          });
        }
      });
    });
  });
}

function assertInitError (applePay, code, other) {
  assert.equal(applePay._ready, false);
  assert.equal(applePay.initError.code, code);
  if (other) {
    for (let prop in other) {
      if (other.hasOwnProperty(prop)) {
        assert.equal(applePay.initError[prop], other[prop]);
      }
    }
  }
}

function ensureDone (done, fn) {
  return function (...args) {
    try {
      fn(...args);
      done();
    } catch (err) {
      done(err);
    }
  };
}

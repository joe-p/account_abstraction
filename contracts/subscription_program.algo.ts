import { Contract } from '@algorandfoundation/tealscript';

// These constants should be template variables, but I made them constants because I'm lazy

/** How frequent this payment can be made */
const FREQUENCY = 1000;
/** Amount of the payment */
const AMOUNT = 100_000;
/** Payment receiver */
const RECEIVER = addr('46XYR7OTRZXISI2TRSBDWPUVQT4ECBWNI7TFWPPS6EKAPJ7W5OBXSNG66M');

export class SubscriptionProgram extends Contract {
  programVersion = 10;

  lastPayment = GlobalStateKey<number>();

  @allow.bareCreate()
  createApplication(): void {
    this.lastPayment.value = 0;
  }

  makePayment(
    sender: Address,
    // eslint-disable-next-line no-unused-vars
    _acctRef: Account
  ): void {
    assert(globals.round - this.lastPayment.value > FREQUENCY);
    this.lastPayment.value = globals.round;

    sendPayment({
      sender: sender,
      amount: AMOUNT,
      receiver: RECEIVER,
      rekeyTo: sender,
    });
  }
}
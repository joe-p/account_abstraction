import { describe, test, beforeAll, beforeEach, expect } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';
import algosdk from 'algosdk';
import { AbstractedAccountClient } from '../contracts/clients/AbstractedAccountClient';
import { OptInPluginClient } from '../contracts/clients/OptInPluginClient';

const ZERO_ADDRESS = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';
algokit.Config.configure({ populateAppCallResources: true });

describe('ARC58 Plugin Permissions', () => {
  /** Alice's externally owned account (ie. a keypair account she has in Pera) */
  let aliceEOA: algosdk.Account;
  /** The client for Alice's abstracted account */
  let abstractedAccountClient: AbstractedAccountClient;
  /** The client for the dummy plugin */
  let dummyPluginClient: OptInPluginClient;
  /** The account that will be calling the plugin */
  let caller: algosdk.Account;
  let plugin: bigint;
  /** The maximum uint64 value. Used to indicate a never-expiring plugin */
  const MAX_UINT64 = BigInt('18446744073709551615');
  const fixture = algorandFixture();

  async function callPlugin() {
    const boxes = [
      new Uint8Array(
        Buffer.concat([
          Buffer.from('p'),
          Buffer.from(algosdk.encodeUint64(plugin)),
          algosdk.decodeAddress(ZERO_ADDRESS).publicKey,
        ])
      ),
      new Uint8Array(
        Buffer.concat([
          Buffer.from('p'),
          Buffer.from(algosdk.encodeUint64(plugin)),
          algosdk.decodeAddress(caller.addr).publicKey,
        ])
      ),
    ];

    await abstractedAccountClient
      .compose()
      .arc58RekeyToPlugin({ plugin }, { sender: caller, sendParams: { fee: algokit.microAlgos(2_000) }, boxes })
      .arc58VerifyAuthAddr({})
      .execute();
  }

  beforeEach(async () => {
    await fixture.beforeEach();

    const { algod } = fixture.context;
    abstractedAccountClient = new AbstractedAccountClient(
      {
        sender: aliceEOA,
        resolveBy: 'id',
        id: 0,
      },
      algod
    );

    // Create an abstracted account app
    await abstractedAccountClient.create.createApplication({
      // Set address to ZERO_ADDRESS so the app address is used
      controlledAddress: ZERO_ADDRESS,
      // aliceEOA will be the admin
      admin: aliceEOA.addr,
    });

    await abstractedAccountClient.appClient.fundAppAccount({ amount: algokit.microAlgos(1_000_000) });
  });

  beforeAll(async () => {
    await fixture.beforeEach();
    const { testAccount } = fixture.context;
    const { algorand } = fixture;
    caller = algorand.account.random().account;

    algorand.send.payment({
      sender: testAccount.addr,
      receiver: caller.addr,
      amount: algokit.microAlgos(1_000_000),
    });

    aliceEOA = testAccount;

    dummyPluginClient = algorand.client.getTypedAppClientById(OptInPluginClient, { id: 0, sender: caller });
    dummyPluginClient.create.createApplication({});
    plugin = BigInt((await dummyPluginClient.appClient.getAppReference()).appId);
  });

  test('both are valid, global is used', async () => {
    const { algorand } = fixture;
    await abstractedAccountClient.arc58AddPlugin({
      app: plugin,
      allowedCaller: caller.addr,
      cooldown: 0,
      lastValidRound: MAX_UINT64,
      adminPrivileges: false,
    });

    await abstractedAccountClient.arc58AddPlugin({
      app: plugin,
      allowedCaller: ZERO_ADDRESS,
      cooldown: 0,
      lastValidRound: MAX_UINT64,
      adminPrivileges: false,
    });

    await callPlugin();

    const globalPluginBox = (await abstractedAccountClient.appClient.getBoxValueFromABIType(
      new Uint8Array(
        Buffer.concat([
          Buffer.from('p'),
          Buffer.from(algosdk.encodeUint64(plugin)),
          algosdk.decodeAddress(ZERO_ADDRESS).publicKey,
        ])
      ),
      algosdk.ABIType.from('(uint64,uint64,uint64)')
    )) as [number, number, number];

    const round = (await algorand.client.algod.status().do())['last-round'];

    expect(globalPluginBox[2]).toBe(BigInt(round));
  });

  test('global valid, global is used', async () => {
    const { algorand } = fixture;

    await abstractedAccountClient.arc58AddPlugin({
      app: plugin,
      allowedCaller: ZERO_ADDRESS,
      cooldown: 0,
      lastValidRound: MAX_UINT64,
      adminPrivileges: false,
    });

    await callPlugin();

    const globalPluginBox = (await abstractedAccountClient.appClient.getBoxValueFromABIType(
      new Uint8Array(
        Buffer.concat([
          Buffer.from('p'),
          Buffer.from(algosdk.encodeUint64(plugin)),
          algosdk.decodeAddress(ZERO_ADDRESS).publicKey,
        ])
      ),
      algosdk.ABIType.from('(uint64,uint64,uint64)')
    )) as [number, number, number];

    const round = (await algorand.client.algod.status().do())['last-round'];

    expect(globalPluginBox[2]).toBe(BigInt(round));
  });

  test('global does not exist, sender valid', async () => {
    const { algorand } = fixture;
    await abstractedAccountClient.arc58AddPlugin({
      app: plugin,
      allowedCaller: caller.addr,
      cooldown: 0,
      lastValidRound: MAX_UINT64,
      adminPrivileges: false,
    });

    await callPlugin();

    const callerPluginBox = (await abstractedAccountClient.appClient.getBoxValueFromABIType(
      new Uint8Array(
        Buffer.concat([
          Buffer.from('p'),
          Buffer.from(algosdk.encodeUint64(plugin)),
          algosdk.decodeAddress(caller.addr).publicKey,
        ])
      ),
      algosdk.ABIType.from('(uint64,uint64,uint64)')
    )) as [number, number, number];

    const round = (await algorand.client.algod.status().do())['last-round'];

    expect(callerPluginBox[2]).toBe(BigInt(round));
  });

  test('not enough cooldown', async () => {
    await abstractedAccountClient.arc58AddPlugin({
      app: plugin,
      allowedCaller: caller.addr,
      cooldown: 100,
      lastValidRound: MAX_UINT64,
      adminPrivileges: false,
    });

    await callPlugin();

    let error = 'no error';
    try {
      await callPlugin();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      error = e.message;
    }

    // TODO: Parse this from src_map json
    expect(error).toMatch('pc=534');
  });
  test('neither sender nor global plugin exists', async () => {
    let error = 'no error';
    try {
      await callPlugin();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      error = e.message;
    }

    // TODO: Parse this from src_map json
    expect(error).toMatch('pc=534');
  });

  test('expired', async () => {
    const { algorand } = fixture;

    await abstractedAccountClient.arc58AddPlugin({
      app: plugin,
      allowedCaller: ZERO_ADDRESS,
      cooldown: 0,
      lastValidRound: 1,
      adminPrivileges: false,
    });

    let error = 'no error';
    try {
      await callPlugin();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      error = e.message;
    }

    // TODO: Parse this from src_map json
    expect(error).toMatch('pc=534');
  });
});

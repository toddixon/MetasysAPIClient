import { GenericObjectPipe } from './generic-object.pipe';

describe('GenericObjectPipe', () => {
  it('create an instance', () => {
    const pipe = new GenericObjectPipe();
    expect(pipe).toBeTruthy();
  });
});

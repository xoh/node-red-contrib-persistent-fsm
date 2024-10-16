/*****

node-red-contrib-state-machine - A Node Red node to implement a state machine using javascript-state-machine

(https://www.npmjs.com/package/java-script-state-machine)

MIT License

Copyright (c) 2018 Dean Cording  <dean@cording.id.au>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without
limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

// Core dependency
const StateMachine = require('javascript-state-machine')

function camelize(label) {
  if (label.length === 0) return label

  let n,
    result,
    word,
    words = label.toString().split(/[_-]/)

  // single word with first character already lowercase, return untouched
  if (words.length === 1 && words[0][0].toLowerCase() === words[0][0]) return label

  result = words[0].toLowerCase()
  for (n = 1; n < words.length; n++) {
    result = result + words[n].charAt(0).toUpperCase() + words[n].substring(1).toLowerCase()
  }

  return result
}

module.exports = function (RED) {
  function StateMachineNode(config) {
    RED.nodes.createNode(this, config)
    if (!config.hasOwnProperty('initialDelay')) config.initialDelay = '0' // Default value for legacy versions

    let node = this

    let stateProperty = config.stateProperty
    let statePropertyType = config.statePropertyType
    let persistStore = config.persistStore
    let persistStoreType = config.persistStoreType
    let persistStoreCustomized = config.persistStoreCustomized

    if (stateProperty === '') {
      node.error('State output property is required in node configuration')
      return
    }

    let states = config.states || []
    let transitions = config.transitions || []

    let savedState = undefined
    if (persistStoreCustomized) {
      if(persistStoreType === 'flow') {
        savedState = node.context().flow.get(persistStore)
      } else if (persistStoreType === 'global') {
        savedState = node.context().global.get(persistStore)
      }
    } else {
      savedState = node.context().get('state')
    }

    let init = config.persistOnReload && savedState !== undefined ? savedState : states[0]
    try {
      node.fsm = new StateMachine({ init, transitions })
    } catch (e) {
      node.status({ fill: 'red', shape: 'dot', text: e.message })
      throw e
    }

    node.status({ fill: 'green', shape: 'dot', text: init })

    if (config.initialDelay !== '') {
      // Anything other than empty string will cause initial sending/setting of state

      if (statePropertyType === 'flow') {
        node.context().flow.set(stateProperty, init)
      } else if (statePropertyType === 'global') {
        node.context().global.set(stateProperty, init)
      } else if (statePropertyType === 'msg') {
        let starter = function () {
          let msg = {}
          RED.util.setMessageProperty(msg, stateProperty, node.fsm.state)
          if (+config.initialDelay) setTimeout(() => node.send(msg), config.initialDelay * 1000)
          else node.send(msg)
        }
        RED.events.on('flows:started', starter)
        node.on('close', function () {
          RED.events.removeListener('flows:started', starter)
        })
      }
    }

    node.on('input', function (msg, send = node.send, done = node.error) {
      if (config.triggerProperty === '') {
        done('Trigger input property is required in node configuration')
        return null
      }

      let trigger = RED.util.evaluateNodeProperty(
        config.triggerProperty,
        config.triggerPropertyType,
        node,
        msg
      )

      let transition = false

      if (node.fsm.can(trigger)) {
        trigger = camelize(trigger)
        node.fsm[trigger]()
        transition = true
      } else if (config.throwException) {
        done(`Can not transition '${trigger}' from state '${node.fsm.state}'`)
        return null
      }

      if (transition || !config.outputStateChangeOnly) {
        if (statePropertyType === 'msg') {
          RED.util.setMessageProperty(msg, stateProperty, node.fsm.state)
        } else if (statePropertyType === 'flow') {
          node.context().flow.set(stateProperty, node.fsm.state)
        } else if (statePropertyType === 'global') {
          node.context().global.set(stateProperty, node.fsm.state)
        }
        send(msg)

        if (persistStoreCustomized) {
          if(persistStoreType === 'flow') {
            savedState = node.context().flow.set(persistStore, node.fsm.state)
          } else if (persistStoreType === 'global') {
            savedState = node.context().global.set(persistStore, node.fsm.state)
          }
        } else {
          node.context().set('state', node.fsm.state)
        }

        node.status({ fill: 'green', shape: 'dot', text: node.fsm.state })
      }
    })
  }
  RED.nodes.registerType('state-machine', StateMachineNode)

  RED.httpAdmin.get('/fsm/graph.js', function (req, res) {
    res.sendFile(`${__dirname}/graph.js`)
  })
}
